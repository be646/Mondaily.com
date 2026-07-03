-- Floor any workspace whose AI-credit balance went NEGATIVE (the pre-fix -166k bug) back to zero
-- via a one-time correction 'grant' row. Going forward, usage is clamped in code so the balance
-- can never drop below zero again (see recordCreditUsage). Idempotent: after running, no balance is
-- < 0, so a re-run inserts nothing.
insert into ai_credits_ledger (workspace_id, amount, transaction_type, description)
select w.id, -bal.balance, 'grant', 'system: negative-balance floor correction'
from workspaces w
join lateral (select ai_credit_balance(w.id) as balance) bal on true
where bal.balance < 0;
