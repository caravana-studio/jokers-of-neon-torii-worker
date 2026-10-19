export interface PaymentAsset { symbol: string; address: string; decimals: number; fee_currency: string | null }
export interface ProviderSnapshot {
  provider_key: string; adapter_kind: string; chain_key: string;
  config: { chain_id: string; treasury_address: string; start_block: string; finality: 'finalized' };
  assets: PaymentAsset[];
  cursor: { next_block: string; last_block_hash: string | null; revision: string };
}
export interface Submission { submission_id: string; tx_hash: string; wallet: string; order: {
  order_id: string; delivery_confirmation?: 'receipt' | 'finalized'; quote: Record<string,string>; created_at: string; expires_at: string;
} }
export interface Observation {
  network_id: string; tx_hash: string; log_index: number; token_address: string; sender: string; recipient: string;
  amount_atomic: string; block_number: string; block_hash: string; paid_at: string;
}
export interface Verification { status: 'pending' | 'verified' | 'review'; code: string | null; events: Observation[] }
export interface ScanPage { from: string; next: string; hash: string; coveredThrough: string; events: Observation[] }
/** Provider verification returns facts; it never creates purchases or grants benefits. */
export interface PaymentAdapter {
  readonly kind: string;
  verify(snapshot: ProviderSnapshot, submission: Submission): Promise<Verification>;
  reconcile?(snapshot: ProviderSnapshot, event: Observation): Promise<{ status: 'pending' | 'finalized' | 'review'; code: string | null }>;
  scan(snapshot: ProviderSnapshot): Promise<ScanPage | null>;
}
export class PaymentAdapters {
  private readonly adapters = new Map<string,PaymentAdapter>();
  register(adapter: PaymentAdapter) {
    if(this.adapters.has(adapter.kind)) throw Error('DUPLICATE_PAYMENT_ADAPTER');
    this.adapters.set(adapter.kind,adapter); return this;
  }
  get(kind: string) {
    const adapter=this.adapters.get(kind);
    if(!adapter) throw Error('PAYMENT_ADAPTER_UNAVAILABLE');
    return adapter;
  }
}
