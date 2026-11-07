use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

// Devnet deployment from Solana Playground. Rebuilding under another keypair changes this id.
declare_id!("7abs7aHfEvbAHfgzBouGnrRFsHMcXY66jnEV4ABogeKR");

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_TITLE_LEN: usize = 64;
/// A far-future deadline would delay refunds indefinitely.
pub const MAX_CAMPAIGN_SECS: i64 = 365 * 24 * 60 * 60;

#[program]
pub mod daylight {
    use super::*;

    pub fn init_org(ctx: Context<InitOrg>, name: String) -> Result<()> {
        require!(
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            DaylightError::NameLength
        );

        let org = &mut ctx.accounts.org;
        org.authority = ctx.accounts.authority.key();
        org.name = name;
        org.campaign_count = 0;
        org.disbursed_count = 0;
        org.confirmed_count = 0;
        org.disputed_count = 0;
        org.disbursed_total = 0;
        org.confirmed_total = 0;
        org.created_at = Clock::get()?.unix_timestamp;

        emit!(OrgCreated {
            org: org.key(),
            authority: org.authority,
        });
        Ok(())
    }

    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        title: String,
        category: Category,
        metadata_hash: [u8; 32],
        target: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(
            !title.is_empty() && title.len() <= MAX_TITLE_LEN,
            DaylightError::TitleLength
        );
        require!(target > 0, DaylightError::ZeroTarget);
        let now = Clock::get()?.unix_timestamp;
        require!(deadline > now, DaylightError::DeadlineInPast);
        require!(
            deadline <= now.checked_add(MAX_CAMPAIGN_SECS).ok_or(DaylightError::Overflow)?,
            DaylightError::DeadlineTooFar
        );

        // A zero-data system account must hold the rent-exempt minimum, or the
        // first transfer into it fails. The org pays that once, here.
        let rent_min = Rent::get()?.minimum_balance(0);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            rent_min,
        )?;

        let org = &mut ctx.accounts.org;
        let id = org.campaign_count;
        org.campaign_count = org.campaign_count.checked_add(1).ok_or(DaylightError::Overflow)?;

        let campaign = &mut ctx.accounts.campaign;
        campaign.org = org.key();
        campaign.id = id;
        campaign.title = title;
        campaign.category = category;
        campaign.metadata_hash = metadata_hash;
        campaign.target = target;
        campaign.raised = 0;
        campaign.disbursed = 0;
        campaign.refunded = 0;
        campaign.donation_count = 0;
        campaign.disbursement_count = 0;
        campaign.deadline = deadline;
        campaign.status = CampaignStatus::Open;

        emit!(CampaignCreated {
            campaign: campaign.key(),
            org: org.key(),
            id,
            target,
            deadline,
        });
        Ok(())
    }

    pub fn donate(ctx: Context<Donate>, amount: u64) -> Result<()> {
        require!(amount > 0, DaylightError::ZeroAmount);
        require!(
            ctx.accounts.campaign.status == CampaignStatus::Open,
            DaylightError::CampaignClosed
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now <= ctx.accounts.campaign.deadline,
            DaylightError::CampaignExpired
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.donor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let campaign = &mut ctx.accounts.campaign;
        let index = campaign.donation_count;
        campaign.donation_count = campaign
            .donation_count
            .checked_add(1)
            .ok_or(DaylightError::Overflow)?;
        campaign.raised = campaign
            .raised
            .checked_add(amount)
            .ok_or(DaylightError::Overflow)?;

        let donation = &mut ctx.accounts.donation;
        donation.campaign = campaign.key();
        donation.donor = ctx.accounts.donor.key();
        donation.index = index;
        donation.amount = amount;
        donation.created_at = now;
        donation.refunded = false;

        emit!(Donated {
            campaign: campaign.key(),
            donor: donation.donor,
            index,
            amount,
        });
        Ok(())
    }

    pub fn disburse(ctx: Context<Disburse>, amount: u64, proof_hash: [u8; 32]) -> Result<()> {
        require!(amount > 0, DaylightError::ZeroAmount);
        require!(
            ctx.accounts.campaign.status == CampaignStatus::Open,
            DaylightError::CampaignClosed
        );
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.campaign.deadline,
            DaylightError::CampaignExpired
        );
        require_keys_neq!(
            ctx.accounts.beneficiary.key(),
            ctx.accounts.authority.key(),
            DaylightError::BeneficiaryIsAuthority
        );
        require_keys_neq!(
            ctx.accounts.beneficiary.key(),
            ctx.accounts.vault.key(),
            DaylightError::BeneficiaryIsAuthority
        );

        let campaign_ref = &ctx.accounts.campaign;
        let available = campaign_ref
            .raised
            .checked_sub(campaign_ref.disbursed)
            .and_then(|v| v.checked_sub(campaign_ref.refunded))
            .ok_or(DaylightError::Overflow)?;
        require!(amount <= available, DaylightError::InsufficientFunds);

        // The beneficiary must end up rent-exempt, or the runtime rejects the
        // transfer: a new account needs the full minimum, a small one the gap.
        let resulting = ctx
            .accounts
            .beneficiary
            .lamports()
            .checked_add(amount)
            .ok_or(DaylightError::Overflow)?;
        require!(
            resulting >= Rent::get()?.minimum_balance(0),
            DaylightError::BelowRentMinimum
        );

        let campaign_key = ctx.accounts.campaign.key();
        let (_, vault_bump) =
            Pubkey::find_program_address(&[b"vault", campaign_key.as_ref()], ctx.program_id);
        let vault_seeds: &[&[u8]] = &[b"vault", campaign_key.as_ref(), &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.beneficiary.to_account_info(),
                },
                &[vault_seeds],
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let campaign = &mut ctx.accounts.campaign;
        let index = campaign.disbursement_count;
        campaign.disbursement_count = campaign
            .disbursement_count
            .checked_add(1)
            .ok_or(DaylightError::Overflow)?;
        campaign.disbursed = campaign
            .disbursed
            .checked_add(amount)
            .ok_or(DaylightError::Overflow)?;

        let org = &mut ctx.accounts.org;
        org.disbursed_count = org
            .disbursed_count
            .checked_add(1)
            .ok_or(DaylightError::Overflow)?;
        org.disbursed_total = org
            .disbursed_total
            .checked_add(amount)
            .ok_or(DaylightError::Overflow)?;

        let disbursement = &mut ctx.accounts.disbursement;
        disbursement.campaign = campaign.key();
        disbursement.index = index;
        disbursement.beneficiary = ctx.accounts.beneficiary.key();
        disbursement.amount = amount;
        disbursement.proof_hash = proof_hash;
        disbursement.status = DisbursementStatus::Sent;
        disbursement.sent_at = now;
        disbursement.responded_at = 0;

        emit!(Disbursed {
            campaign: campaign.key(),
            org: org.key(),
            beneficiary: disbursement.beneficiary,
            index,
            amount,
            proof_hash,
        });
        Ok(())
    }

    /// The beneficiary, and only the beneficiary, answers for a payout. The org
    /// has no instruction that touches `confirmed_*` or `disputed_*`.
    pub fn respond_receipt(ctx: Context<RespondReceipt>, accepted: bool) -> Result<()> {
        require!(
            ctx.accounts.disbursement.status == DisbursementStatus::Sent,
            DaylightError::AlreadyResponded
        );

        let disbursement = &mut ctx.accounts.disbursement;
        let org = &mut ctx.accounts.org;
        if accepted {
            disbursement.status = DisbursementStatus::Confirmed;
            org.confirmed_count = org
                .confirmed_count
                .checked_add(1)
                .ok_or(DaylightError::Overflow)?;
            org.confirmed_total = org
                .confirmed_total
                .checked_add(disbursement.amount)
                .ok_or(DaylightError::Overflow)?;
        } else {
            disbursement.status = DisbursementStatus::Disputed;
            org.disputed_count = org
                .disputed_count
                .checked_add(1)
                .ok_or(DaylightError::Overflow)?;
        }
        disbursement.responded_at = Clock::get()?.unix_timestamp;

        emit!(ReceiptResponded {
            campaign: ctx.accounts.campaign.key(),
            org: org.key(),
            beneficiary: disbursement.beneficiary,
            index: disbursement.index,
            accepted,
        });
        Ok(())
    }

    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        require!(
            campaign.status == CampaignStatus::Open,
            DaylightError::CampaignClosed
        );
        campaign.status = CampaignStatus::Closed;

        emit!(CampaignClosed {
            campaign: campaign.key(),
            org: ctx.accounts.org.key(),
        });
        Ok(())
    }

    /// Pro-rata refund of one donation once the campaign has expired or been
    /// closed. Disbursements are frozen at that point (disburse needs an open,
    /// unexpired campaign), so `raised - disbursed` is the fixed pool to share.
    /// Floor division keeps the sum of refunds at or below that pool.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            !ctx.accounts.donation.refunded,
            DaylightError::AlreadyRefunded
        );
        let now = Clock::get()?.unix_timestamp;
        let campaign_ref = &ctx.accounts.campaign;
        let ended = now > campaign_ref.deadline || campaign_ref.status == CampaignStatus::Closed;
        require!(ended, DaylightError::RefundNotAvailable);

        let unspent = campaign_ref
            .raised
            .checked_sub(campaign_ref.disbursed)
            .ok_or(DaylightError::Overflow)?;
        let amount = (ctx.accounts.donation.amount as u128)
            .checked_mul(unspent as u128)
            .and_then(|v| v.checked_div(campaign_ref.raised as u128))
            .and_then(|v| u64::try_from(v).ok())
            .ok_or(DaylightError::Overflow)?;
        let campaign_key = ctx.accounts.campaign.key();
        let (_, vault_bump) =
            Pubkey::find_program_address(&[b"vault", campaign_key.as_ref()], ctx.program_id);
        let vault_seeds: &[&[u8]] = &[b"vault", campaign_key.as_ref(), &[vault_bump]];
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.donor.to_account_info(),
                },
                &[vault_seeds],
            ),
            amount,
        )?;

        let campaign = &mut ctx.accounts.campaign;
        campaign.refunded = campaign
            .refunded
            .checked_add(amount)
            .ok_or(DaylightError::Overflow)?;
        let donation = &mut ctx.accounts.donation;
        donation.refunded = true;

        emit!(Refunded {
            campaign: campaign.key(),
            donor: donation.donor,
            index: donation.index,
            amount,
        });
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// One per charity. The counters are written only by `disburse` (org signs)
/// and `respond_receipt` (beneficiary signs), never directly by the org.
#[account]
#[derive(InitSpace)]
pub struct OrgProfile {
    pub authority: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub campaign_count: u32,
    pub disbursed_count: u32,
    pub confirmed_count: u32,
    pub disputed_count: u32,
    pub disbursed_total: u64,
    pub confirmed_total: u64,
    pub created_at: i64,
}

#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub org: Pubkey,
    pub id: u32,
    #[max_len(64)]
    pub title: String,
    pub category: Category,
    /// sha256 of the off-chain campaign description. No child data on-chain.
    pub metadata_hash: [u8; 32],
    pub target: u64,
    pub raised: u64,
    pub disbursed: u64,
    pub refunded: u64,
    pub donation_count: u32,
    pub disbursement_count: u32,
    pub deadline: i64,
    pub status: CampaignStatus,
}

/// One receipt per donation (the donor's own proof of what they gave).
#[account]
#[derive(InitSpace)]
pub struct Donation {
    pub campaign: Pubkey,
    pub donor: Pubkey,
    pub index: u32,
    pub amount: u64,
    pub created_at: i64,
    pub refunded: bool,
}

#[account]
#[derive(InitSpace)]
pub struct Disbursement {
    pub campaign: Pubkey,
    pub index: u32,
    /// Guardian, school or vendor wallet. Never a child.
    pub beneficiary: Pubkey,
    pub amount: u64,
    /// sha256 of a receipt or photo the org keeps off-chain.
    pub proof_hash: [u8; 32],
    pub status: DisbursementStatus,
    pub sent_at: i64,
    /// 0 until the beneficiary responds.
    pub responded_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Category {
    Education,
    Food,
    Health,
    Supplies,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CampaignStatus {
    Open,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DisbursementStatus {
    Sent,
    Confirmed,
    Disputed,
}

// ---------------------------------------------------------------------------
// Events: one per instruction, so the UI and verify script read history cheaply
// ---------------------------------------------------------------------------

#[event]
pub struct OrgCreated {
    pub org: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub org: Pubkey,
    pub id: u32,
    pub target: u64,
    pub deadline: i64,
}

#[event]
pub struct Donated {
    pub campaign: Pubkey,
    pub donor: Pubkey,
    pub index: u32,
    pub amount: u64,
}

#[event]
pub struct Disbursed {
    pub campaign: Pubkey,
    pub org: Pubkey,
    pub beneficiary: Pubkey,
    pub index: u32,
    pub amount: u64,
    pub proof_hash: [u8; 32],
}

#[event]
pub struct ReceiptResponded {
    pub campaign: Pubkey,
    pub org: Pubkey,
    pub beneficiary: Pubkey,
    pub index: u32,
    pub accepted: bool,
}

#[event]
pub struct CampaignClosed {
    pub campaign: Pubkey,
    pub org: Pubkey,
}

#[event]
pub struct Refunded {
    pub campaign: Pubkey,
    pub donor: Pubkey,
    pub index: u32,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum DaylightError {
    #[msg("Name must be 1-32 bytes")]
    NameLength,
    #[msg("Title must be 1-64 bytes")]
    TitleLength,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Target must be greater than zero")]
    ZeroTarget,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Deadline is more than one year away")]
    DeadlineTooFar,
    #[msg("Campaign is closed")]
    CampaignClosed,
    #[msg("Campaign deadline has passed")]
    CampaignExpired,
    #[msg("Not enough unspent funds in the campaign")]
    InsufficientFunds,
    #[msg("Beneficiary cannot be the org authority or the campaign vault")]
    BeneficiaryIsAuthority,
    #[msg("A new beneficiary account needs at least the rent-exempt minimum")]
    BelowRentMinimum,
    #[msg("This disbursement has already been answered")]
    AlreadyResponded,
    #[msg("Campaign does not belong to this org")]
    WrongOrg,
    #[msg("Refund not available yet")]
    RefundNotAvailable,
    #[msg("Donation already refunded")]
    AlreadyRefunded,
    #[msg("Arithmetic overflow")]
    Overflow,
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitOrg<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + OrgProfile::INIT_SPACE,
        seeds = [b"org", authority.key().as_ref()],
        bump
    )]
    pub org: Account<'info, OrgProfile>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority,
        seeds = [b"org", authority.key().as_ref()],
        bump
    )]
    pub org: Account<'info, OrgProfile>,
    #[account(
        init,
        payer = authority,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [b"campaign", org.key().as_ref(), &org.campaign_count.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Donate<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = donor,
        space = 8 + Donation::INIT_SPACE,
        seeds = [b"donation", campaign.key().as_ref(), &campaign.donation_count.to_le_bytes()],
        bump
    )]
    pub donation: Account<'info, Donation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Disburse<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority,
        seeds = [b"org", authority.key().as_ref()],
        bump
    )]
    pub org: Account<'info, OrgProfile>,
    #[account(mut, has_one = org @ DaylightError::WrongOrg)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(mut)]
    pub beneficiary: SystemAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Disbursement::INIT_SPACE,
        seeds = [b"disb", campaign.key().as_ref(), &campaign.disbursement_count.to_le_bytes()],
        bump
    )]
    pub disbursement: Account<'info, Disbursement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RespondReceipt<'info> {
    pub beneficiary: Signer<'info>,
    #[account(
        mut,
        seeds = [b"org", org.authority.as_ref()],
        bump
    )]
    pub org: Account<'info, OrgProfile>,
    #[account(has_one = org @ DaylightError::WrongOrg)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        has_one = campaign,
        has_one = beneficiary,
        seeds = [b"disb", campaign.key().as_ref(), &disbursement.index.to_le_bytes()],
        bump
    )]
    pub disbursement: Account<'info, Disbursement>,
}

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    pub authority: Signer<'info>,
    #[account(
        has_one = authority,
        seeds = [b"org", authority.key().as_ref()],
        bump
    )]
    pub org: Account<'info, OrgProfile>,
    #[account(mut, has_one = org @ DaylightError::WrongOrg)]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub donor: Signer<'info>,
    #[account(mut)]
    pub campaign: Account<'info, Campaign>,
    #[account(
        mut,
        seeds = [b"vault", campaign.key().as_ref()],
        bump
    )]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        has_one = campaign,
        has_one = donor,
        seeds = [b"donation", campaign.key().as_ref(), &donation.index.to_le_bytes()],
        bump
    )]
    pub donation: Account<'info, Donation>,
    pub system_program: Program<'info, System>,
}
