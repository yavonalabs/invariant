---
title: I built an open-source CLI to catch Stripe race conditions because "HTTP 200" is a lie.
tags: node, architecture, stripe, opensource
---

For the last few months, I've been building something on nights and weekends: a CLI tool that proves whether a payment webhook handler *actually* works, not just whether it returns `200 OK`.

### The Problem with APMs
If you build backend systems, you already use tools like Sentry or Datadog. They are incredible for telling you if your application threw an exception or if a server crashed.

But there is a terrifying category of bugs that APMs are completely blind to. 

What happens when 20 concurrent webhooks hit your backend at the exact same millisecond, and you forgot to place a database transaction lock on the user's balance update?

**Nothing crashes.** Nothing throws an error. The server remains perfectly "healthy" the entire time. Every single request returns `200 OK`. 

...But the money disappears. The concurrent read-modify-write queries silently clobber each other.

### Meet Invariant
I built [Invariant](https://yavonalabs.com) to catch exactly this. It's an open-source Business Invariant Engine. 

Instead of checking if your code crashed, it simulates catastrophic concurrent edge cases and checks the actual *business state* (the database) afterward.

I built a zero-config, 60-second demo baked right into the CLI so you can see exactly how it works. You don't need a Stripe account, a database, or Docker. 

Just run this in your terminal:
`npx @yavona/invariant demo`

It spins up a vulnerable in-memory server and fires 20 concurrent webhooks at it. The output looks like this:

```text
[FAIL] 4. Concurrent Processing (Race conditions)
       -> Expected Balance: $100000.00
       -> Actual Balance:   $5000.00
       -> All 20 webhooks returned HTTP 200, but 19 ledger updates were silently overwritten.
```

### Try it out & Beta Partners
The CLI is completely free and open-source. You can run it against your own local development environments to stress-test your idempotency and database locks. 

Check out the repo here: [GitHub - YavonaLabs/invariant](https://github.com/yavonalabs/invariant)

**One last thing:** I am currently looking for 3 startups to be early design partners for the commercial side of this engine. If your backend relies on Stripe or Razorpay, I will run a full payment reliability code audit for your company for FREE in exchange for your feedback. 

If you are interested, DM me on [Twitter/X](https://x.com/yavonalabs) or drop a comment below!
