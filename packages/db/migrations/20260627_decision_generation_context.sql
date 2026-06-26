-- Generation-layer capture for the AI training corpus.
--
-- LLM-generated decisions (prospecting, vertical agents, chat create_decision)
-- store the real {system_prompt, user_prompt, model_output} that produced the
-- recommendation here. The training ledger reads this instead of NULL, so the
-- fine-tuning corpus gets true prompt→output pairs. Rule-based decisions
-- (e.g. invoice_chaser) leave it NULL and can be excluded from the corpus.
alter table decision_queue add column if not exists generation_context jsonb;
