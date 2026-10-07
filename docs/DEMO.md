# Five-minute reviewer walkthrough

1. **Frame the decision:** “I kept AI advisory. A deterministic scheduler creates valid choices, and a dispatcher approves the final schedule.”
2. **Generate:** Point out the timeline, priority/deadline strategy, missing-skill question, unmatched lift request, and explicit draft status. State which provider the running app actually uses.
3. **Challenge a draft:** Try a conflicting time; explain that the server rejects overlaps even if a frontend user changes the request. Make a valid edit and show its logged reason.
4. **Approve:** Open the confirmation dialog and accept. Show the mock notification outbox. It was empty before approval.
5. **Disrupt the day:** Start the clinic job, cancel Asha, and add an urgent North electrical job. Generate a revision; point out the preserved in-progress block (including technician and time slot) and before/after diff.
6. **Close with evidence:** Approve and open history and audit. Refresh to demonstrate persistence. Briefly show the tests for concurrent approvals and completed/in-progress preservation.

## Decisions to be ready to explain

- Why preferred windows and regions are strict in this bounded scenario.
- Why greedy candidates are adequate for the scope, and where a solver would improve results.
- Why AI selects valid candidates rather than writing unrestricted assignments.
- Why both workspace and draft revisions are checked, and why a transaction takes a row lock.
- Why audit events and notifications commit with approval.
- Why MockProvider is visible and a real provider failure does not silently become an apparent AI success.
- Why JSON workspace storage is a scope trade-off, and what normalized tables and per-user authorization would add.

Use your own words. Run each step yourself before recording or presenting. Do not claim tests, deployments, or design work you have not reviewed.

Cancellation policy: started work finishes with its original technician and time slot; future unstarted appointments are replanned. This demo does not model an interrupted-job handoff. Complete the started job after replanning to show that finish remains available even though the technician has cancelled future work.
