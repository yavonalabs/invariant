---
name: Developer Validation Feedback
about: Provide feedback on testing your backend with @yavona/invariant
title: '[Feedback]: '
labels: 'developer-feedback'
assignees: ''
---

### 1. Setup Time
How long did it take to get your first `npx @yavona/invariant test stripe-webhooks` run passing or failing against your backend?
- [ ] Under 5 minutes
- [ ] 5 - 15 minutes
- [ ] Over 15 minutes (please describe setup friction)

### 2. Bug Discovery / Value
Did Invariant catch any unexpected state behavior, missing idempotency logic, or signature handling edge case in your application?
- [ ] Yes! (Describe what it caught: _________)
- [ ] No bugs found, but gave confidence in our existing handler.
- [ ] Encountered setup issues / false failure (Describe: _________)

### 3. Feature Requests / Roadmap
What feature or provider adapter would make Invariant essential for your team's workflow?
- [ ] Generic HMAC Webhook Adapter
- [ ] PayPal / Shopify Webhook Support
- [ ] Custom CLI Assertion Generators
- [ ] Other: __________
