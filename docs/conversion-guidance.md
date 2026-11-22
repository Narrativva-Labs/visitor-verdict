# Conversion guidance: label, never exclude

Decision as of 22 November 2026. It replaces earlier reference designs that held unverified leads or kept some conversions away from ad platforms.

## The rule

**Visitor Verdict only labels traffic.** By default nothing is excluded, filtered, held or withheld anywhere:

- **GA4:** every event and conversion is collected and kept. Labels are event parameters (`traffic_class`, `traffic_agent`, `traffic_phase`); reports compare labelled segments, they do not delete them.
- **Google Ads and Meta:** send conversions exactly as you would without Visitor Verdict. The project recommends no exception triggers, no holds and no drops based on the class.
- **Leads and sign-ups:** process and send them as usual. Lead quality is judged by your normal qualification (confirmed email, CRM status), not by the traffic class.

The labels are for analysis and review. Whether to change what you send to an ad platform is your own decision; it is not a default of this project.

## Why

- **Agent-assisted purchases are real revenue.** Browser agents such as Claude in Chrome or OpenAI's browser agent run in a person's own browser, with that person's account and card. The person asked the agent to act. A `declared_agent` purchase with `traffic_agent` set is a customer buying through a tool.
- **The labels are self-declared, unverified browser evidence.** A UA token or an agent UI marker is a claim, and `human` means only that no automation was detected. Neither is reliable enough to decide on its own which revenue counts.
- **Excluding by default loses data you cannot get back.** A held or dropped conversion is gone for bidding and attribution; a labelled one can still be analysed, segmented or adjusted later.
- **Payment and fraud checks already exist.** Refunds, chargebacks and fraud review belong to the payment and order systems. Send orders with their order ID so that platforms can apply later adjustments (for example Google Ads [conversion adjustments](https://support.google.com/google-ads/answer/7686447)).

## How to report on labelled conversions

Use GA4 or the BigQuery export; see [GA4 reporting](ga4-reporting.md#reporting) and [analysis](analysis/ga4-explorations.md).

1. **Headline: all sessions and all revenue.** Report purchase conversion rate as purchasing sessions / sessions over all sessions.
2. **Break revenue down by label, do not subtract it.** Show purchases and revenue for agent-assisted sessions (`declared_agent`, with `traffic_agent` when known), sessions with `automated` evidence, `suspicious` sessions and unlabelled sessions. Agent-assisted revenue stays in the total.
3. **Use the session, not the event.** A session counts as labelled if any event carries the label; a later `human` does not cancel earlier evidence. Initial, agent and final hits for one page are expected duplicates.
4. **Compare rates with and without labelled sessions as a sensitivity check.** Leaving low-converting automated sessions out of a comparison raises conversion rate by arithmetic; that is not marketing improvement. Keep the same cohort in numerator and denominator.
5. **Review, do not relabel.** Converting or long-engaged `automated` sessions deserve a look (test orders, monitoring, a real person with unusual tooling); they are not automatically fraud and not automatically human.
6. **Watch agent share over time.** `traffic_phase = agent` and `traffic_agent` show how often agents act on the site and which operator; useful for checkout and form design (for example, agents need clear labels and no hidden steps).

## What not to do

- Do not exclude, hold or drop conversions, leads or sessions by default because of `traffic_class`.
- Do not send the visitor label itself to ad platforms; no platform defines a parameter for it and it is not needed there.
- Do not use the class to block access, deny service or make decisions about individuals.
- Do not use pre-consent classifications for advertising; follow the site's consent setup (see [privacy](privacy.md#consent-and-deployment)).

## Server-side verification

Server-side verification of signed agents (Web Bot Auth, published IP ranges) is in development on the [`phase2-verifier`](https://github.com/Narrativva-Labs/visitor-verdict/tree/phase2-verifier/server) branch. It follows the same rule: it adds labels, it withholds nothing.

## Open questions

- No platform has published how agent-made conversions should be marked or sent.
- No independent study quantifies how bot or agent conversions affect Smart Bidding or Advantage+.
- Privacy: this is not legal advice. Check the legal basis for any data you send to ad platforms with your own counsel.
