use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

// Solana Playground replaces this id with your own when you press Build.
declare_id!("11111111111111111111111111111111");

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_TITLE_LEN: usize = 64;

#[program]
pub mod daylight {
    use super::*;
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
    #[msg("Campaign is closed")]
    CampaignClosed,
    #[msg("Campaign deadline has passed")]
    CampaignExpired,
    #[msg("Not enough unspent funds in the campaign")]
    InsufficientFunds,
    #[msg("Beneficiary cannot be the org authority")]
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
