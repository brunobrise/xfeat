const { exportedSymbols } = require("./lib/professional-docs-exports");

function names(file, text) {
  return exportedSymbols({ file, text }).map((api) => api.name);
}

function apiNamed(file, text, name) {
  return exportedSymbols({ file, text }).find((api) => api.name === name);
}

describe("Public API detection", () => {
  it("keeps JavaScript export declarations and export lists", () => {
    const text = [
      "export class BillingService {}",
      "export async function buildInvoice() {}",
      "export const TAX_RATE = 0.2;",
      "function internal() {}",
      "export { internal as publicHelper };",
    ].join("\n");

    expect(names("src/billing.js", text)).toEqual([
      "BillingService",
      "buildInvoice",
      "TAX_RATE",
      "publicHelper",
    ]);
  });

  it("treats Rust pub items as public and restricted visibility as private", () => {
    const text = [
      "pub struct Ledger {",
      "    entries: Vec<Entry>,",
      "}",
      "pub enum EntryKind { Debit, Credit }",
      "pub trait Store {}",
      "pub type Balance = i64;",
      "pub const MAX_ENTRIES: usize = 1024;",
      'pub static VERSION: &str = "1";',
      "pub mod accounts;",
      "pub use crate::accounts::{Account, Owner as AccountOwner};",
      "pub use crate::accounts::*;",
      "impl Ledger {",
      "    pub async fn post_entry(&mut self) {}",
      "    pub const fn capacity() -> usize { 0 }",
      "    pub(crate) fn rebuild(&mut self) {}",
      "    fn validate(&self) {}",
      "}",
      'pub unsafe extern "C" fn ledger_ffi() {}',
      "pub(super) struct Cache;",
      "pub(in crate::accounts) fn scoped() {}",
      "// pub fn commented_out() {}",
      "/// pub fn documented_example() {}",
      "fn private_helper() {}",
    ].join("\n");

    expect(names("crates/ledger-core/src/lib.rs", text)).toEqual([
      "Ledger",
      "EntryKind",
      "Store",
      "Balance",
      "MAX_ENTRIES",
      "VERSION",
      "accounts",
      "Account",
      "AccountOwner",
      "post_entry",
      "capacity",
      "ledger_ffi",
    ]);
    expect(apiNamed("src/lib.rs", text, "Ledger")).toMatchObject({
      type: "struct",
      line: 1,
    });
    expect(apiNamed("src/lib.rs", text, "post_entry")).toMatchObject({
      type: "function",
      line: 13,
    });
    expect(apiNamed("src/lib.rs", text, "Account")).toMatchObject({
      type: "re-export",
      line: 10,
    });
  });

  it("treats exported Go identifiers as public and skips test files", () => {
    const text = [
      "package payments",
      "",
      "type Gateway struct{}",
      "type config struct{}",
      "",
      "func Charge(amount int) error { return nil }",
      "func refund() {}",
      "func (g *Gateway) Authorize() bool { return true }",
      "func (g *Gateway) retry() {}",
      "",
      "const (",
      '\tDefaultCurrency = "EUR"',
      "\tmaxRetries = 3",
      ")",
      'var ErrDeclined = errors.New("declined")',
      "var (",
      "\tTimeout = 30",
      ")",
    ].join("\n");

    expect(names("payments.go", text)).toEqual([
      "Gateway",
      "Charge",
      "Authorize",
      "DefaultCurrency",
      "ErrDeclined",
      "Timeout",
    ]);
    expect(apiNamed("payments.go", text, "Authorize")).toMatchObject({
      type: "method",
      line: 8,
    });
    expect(
      names("payments_test.go", "func TestCharge(t *testing.T) {}\n"),
    ).toEqual([]);
  });

  it("treats Python module-level public names as public", () => {
    const text = [
      "import os",
      "",
      "MAX_LINES = 50",
      "logger = make_logger()",
      "_CACHE = {}",
      "",
      "class Invoice:",
      "    def total(self):",
      "        return 0",
      "",
      "def create_invoice(customer):",
      "    def nested():",
      "        pass",
      "    return Invoice()",
      "",
      "async def sync_invoices():",
      "    pass",
      "",
      "def _private():",
      "    pass",
    ].join("\n");

    expect(names("billing/invoices.py", text)).toEqual([
      "MAX_LINES",
      "Invoice",
      "create_invoice",
      "sync_invoices",
    ]);
    expect(
      names("tests/test_invoices.py", "def test_total():\n    pass\n"),
    ).toEqual([]);
    expect(
      names("billing/invoices_test.py", "def check():\n    pass\n"),
    ).toEqual([]);
    expect(names("conftest.py", "def fixture():\n    pass\n")).toEqual([]);
  });

  it("uses Python __all__ exactly when a module declares it", () => {
    const text = [
      "from .models import Invoice",
      "",
      "__all__ = [",
      '    "create_invoice",',
      "    'Invoice',",
      "]",
      "",
      "def create_invoice():",
      "    pass",
      "",
      "def helper():",
      "    pass",
    ].join("\n");

    expect(names("billing/__init__.py", text)).toEqual([
      "Invoice",
      "create_invoice",
    ]);
    expect(apiNamed("billing/__init__.py", text, "Invoice")).toMatchObject({
      type: "export",
      line: 5,
    });
    expect(
      apiNamed("billing/__init__.py", text, "create_invoice"),
    ).toMatchObject({ type: "function", line: 8 });
  });
});
