# Ad-platform recipes: labels for reporting only

Keep every purchase and your existing conversion goals. Add labels to the conversion you already send; never use them for exclusions, audiences, optimization targets or bidding changes. Apply the site’s advertising-consent rules. Do not forward pre-consent labels to advertising platforms. See [conversion guidance](conversion-guidance.md).

## Meta: a “Purchase – agent” reporting column

Add a passive parameter to the existing **Purchase** event. Preserve its value, currency and browser/CAPI deduplication IDs; do not send another purchase just to attach a label.

| Route | Parameter | Value |
|---|---|---|
| Browser Pixel | `traffic_class` in the Purchase parameter object | `{{VV - current class}}` at firing time |
| sGTM CAPI | `custom_data.vv_type` | Template variable with **Output field = vv_type** |
| sGTM CAPI | `custom_data.vv_detail` | Template variable with **Output field = vv_detail** |

For Pixel, add `traffic_class` as a custom property alongside `value` and `currency`, not as a nested `custom_data` object. [Meta documents custom Pixel properties](https://developers.facebook.com/documentation/meta-pixel/implementation/conversion-tracking#custom-properties).

In the **stape-io Facebook Conversion API** tag, map `vv_type` and `vv_detail` in its Custom Data settings directly to those two template variables. No extra data-layer echo is needed. This parameter mapping was verified in a real sGTM container with that tag. Preview the outgoing CAPI payload and check the event in Events Manager.

In **Events Manager → Custom conversions → Create**, select the existing data source and **Purchase**, name it **Purchase – agent**, and add a rule on its event parameter (from `custom_data`):

- Browser route: `traffic_class` equals `declared_agent`.
- Server route: `vv_type` equals `agent_verified`; add `vv_detail` contains `|user_directed|` if the column must specifically mean user-directed agents. `agent_unverified` is a separate declaration segment; `automation_verified` is infrastructure.

Choose the rule matching your route; these are different evidence levels. In **Ads Manager → Columns → Customize columns**, add **Purchase – agent** alongside total purchases. Use it only as a reporting column; never select it as the campaign/ad-set optimization event. [Meta custom conversion rules](https://developers.facebook.com/docs/marketing-api/reference/custom-conversion/).

## Google Ads: a custom variable on the existing conversion

1. Open **Goals → Conversions → Custom variables → +**. Choose a report name and **Tag string** `traffic_class` (or `vv_type` for a server-derived label).
2. In web GTM, edit the existing **Google Ads Conversion Tracking** tag. Under **Event Parameters**, add `traffic_class = {{VV - current class}}`. Use `vv_type` only where a server actually supplies it; never invent a verified value from browser evidence.
3. After the parameter arrives, return to Custom variables and **Activate** it: status must be **Enabled**. Recording starts after activation, not retroactively. [Google’s setup instructions](https://support.google.com/google-ads/answer/9962082?hl=en).

With `gtag`, put the tag string at the **top level** of the existing conversion object, not inside `custom_data` or another object. Replace the illustrative value with the current classification; retain your real conversion ID, order ID, value and currency:

```javascript
gtag('event', 'conversion', {
  send_to: 'AW-ID/LABEL',
  transaction_id: 'ORDER_ID',
  value: 100,
  currency: 'USD',
  traffic_class: 'declared_agent'
});
```

For reporting, use **Segment → Conversions → Custom variable** and select the enabled variable. Keep the existing conversion action and bidding goal; do not create a second conversion to count the labelled subset. [Google’s reporting instructions](https://support.google.com/google-ads/answer/9962082?hl=en).

Limits to plan for:

- Maximum **50 variables per account**. [Google Ads API guide](https://developers.google.com/google-ads/api/docs/conversions/conversion-custom-variables).
- Names and values: at most **100 characters**; tag strings: at most **100 bytes**, lowercase letters, numbers and underscores, immutable after creation. Use bounded labels, never PII or sensitive information. [Field limits](https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionCustomVariable), [data limits](https://support.google.com/google-ads/answer/9962082?hl=en).
- Enhanced conversions for leads imports with user-provided data do **not** support custom variables, including flows without `gclid`; adding `gclid` does not remove that restriction. `gbraid`/`wbraid` uploads without `gclid` also do not support them. This differs from enhanced conversions for web. [Google’s import restrictions](https://developers.google.com/google-ads/api/docs/conversions/upload-offline).
- Modelled/no-consent conversions may have no label: plan for **`(not set)`** or totals visible only without the segment. Google documents that conversions missing a variable are omitted from its segment rows; it does not guarantee labels on modelled conversions. Never treat missing as `human`. [Reporting limitations](https://support.google.com/google-ads/answer/9962082?hl=en).
- Use this recipe for a **direct Google Ads conversion tag**, not conversions imported from GA4. Google documents website-tag and offline-import paths; do not rely on GA4 custom parameters transferring into Ads custom variables. [Supported paths](https://support.google.com/google-ads/answer/9964350?hl=en).
