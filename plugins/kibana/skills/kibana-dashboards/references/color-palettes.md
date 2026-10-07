# Kibana Palette Catalog

The palettes Kibana's Lens palette pickers offer, with their ids and light-theme color stops. Generated from Kibana's
own palette definitions (`@kbn/palettes`, Kibana main branch, September 2026). Legacy palettes are excluded so that
generated charts use the current palette set unless the user asks otherwise.

Use this catalog whenever you write explicit colors: every hex value in a `steps[]` entry or a categorical `mapping[]`
MUST be copied verbatim from a preview line below. Never invent colors. When judging whether an existing color belongs
to a palette, compare the saved hex values, not a screenshot. See [Color](chart-design.md#color) for when color is
appropriate and which palette fits which meaning.

## Gradient palettes

For threshold bands and magnitude. Charts sample a palette at the number of bands they use: pick the preview line
matching your step count (3 bands for metrics, 4 for gauges, 5 for heatmaps and tables) and copy those hex values in
order. To reverse a palette, reverse the order of the `steps` colors yourself — there is no `reverse` field.

| Name          | Id              | Meaning                               |
| ------------- | --------------- | ------------------------------------- |
| Status        | `status`        | Threshold bands: good → warning → bad |
| Temperature   | `temperature`   | Intensity / cold-to-hot magnitude     |
| Complementary | `complementary` | Divergence around a midpoint          |
| Negative      | `red`           | Adverse values (higher is worse)      |
| Positive      | `green`         | Favorable values (higher is better)   |
| Cool          | `cool`          | Neutral magnitude                     |
| Warm          | `warm`          | Neutral magnitude                     |
| Gray          | `gray`          | Neutral magnitude                     |

### 3-stop previews (metric status bands)

- Status: #24c292, #fcd883, #f6726a
- Temperature: #61a2ff, #ebeff5, #f6726a
- Complementary: #61a2ff, #f6f9fc, #eaae01
- Negative: #fdcdc9, #fda198, #f6726a
- Positive: #bde8d8, #7fd5b4, #24c292
- Cool: #c4daff, #95beff, #61a2ff
- Warm: #ffcac3, #fe9f96, #f6726a
- Gray: #a2aec4, #596883, #1d2a3e

### 4-stop previews (gauge bands)

- Status: #24c292, #aee8d2, #ffc9c2, #f6726a
- Temperature: #61a2ff, #cfe1ff, #ffd4cf, #f6726a
- Complementary: #61a2ff, #accefe, #f0d47f, #eaae01
- Negative: #fcd8d6, #feb7b0, #fc968d, #f6726a
- Positive: #cbece1, #9fdfc6, #6dd1ac, #24c292
- Cool: #cfe1ff, #adccff, #89b7ff, #61a2ff
- Warm: #ffd5cf, #ffb5ac, #fc948b, #f6726a
- Gray: #b6c0d3, #7b8aa4, #485872, #1d2a3e

### 5-stop previews (heatmap and table bands)

- Status: #24c292, #aee8d2, #fcd883, #ffc9c2, #f6726a
- Temperature: #61a2ff, #cfe1ff, #f6f9fc, #ffd4cf, #f6726a
- Complementary: #61a2ff, #accefe, #f6f9fc, #f0d47f, #eaae01
- Negative: #fcdfdd, #fec4bf, #feaaa2, #fb8f86, #f6726a
- Positive: #d4efe6, #b1e4d1, #8cd9bb, #62cea6, #24c292
- Cool: #d6e5ff, #bad5ff, #9fc4ff, #82b3ff, #61a2ff
- Warm: #ffdbd6, #ffc2ba, #ffa89f, #fb8d84, #f6726a
- Gray: #c2cbdb, #92a0b8, #667690, #3f4e67, #1d2a3e

## Categorical palettes

For distinct categories. Configs reference the **id**, not the name, in
`color: { mode: "categorical", palette: "<id>", mapping: [] }`. The previews show the first five colors of each palette.

- `default` (Elastic, 10 colors): #16C5C0, #A6EDEA, #61A2FF, #BFDBFF, #EE72A6
- `elastic_line_optimized` (Elastic, line optimized, 10 colors): #16C5C0, #61A2FF, #EE72A6, #EAAE01, #F6726A
- `severity` (Severity, 6 colors): #24C292, #B5E5F2, #FCD883, #FF995E, #EE4C48

## Excluded legacy palettes

Never introduce or switch a chart to these ids: `eui_amsterdam` (Kibana 7.0), `kibana_v7_legacy` (Kibana 4.0),
`elastic_brand_2023` (Elastic classic). An existing chart that already uses one is not automatically wrong — leave it
unless the user asks for a recolor.
