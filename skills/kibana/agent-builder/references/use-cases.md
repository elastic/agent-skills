# Elastic Agent Builder — Use Case Playbooks

---

## 1. Customer Feedback Analysis Agent

**Goal**: Analyze customer feedback, identify sentiment trends, surface policy-related mentions, and generate analytics.

**Key Tools**:

- `platform.core.search` — semantic search over feedback indices for open-ended queries
- Custom Index Search tool scoped to `customer-feedback-*` — focused retrieval
- Custom ES|QL tool for sentiment aggregations and trend analytics

### Custom Index Search Tool

`POST /api/agent_builder/tools`

```json
{
  "id": "customer_feedback_search",
  "type": "index_search",
  "description": "Searches customer feedback, support tickets, and NPS responses. Use this to find sentiment, product complaints, praise, or policy mentions. Supports semantic and keyword search.",
  "configuration": {
    "pattern": "customer-feedback-*"
  }
}
```

### Custom ES|QL Tool — Sentiment Trend by Product

`POST /api/agent_builder/tools`

```json
{
  "id": "feedback_sentiment_trend",
  "type": "esql",
  "description": "Returns a breakdown of positive vs. negative feedback counts by product category over a given number of days. Use for trend analysis, not for reading individual feedback.",
  "configuration": {
    "query": "FROM customer-feedback-* | WHERE @timestamp >= NOW() - ?lookback_days::integer * 1d | STATS positive = COUNT(*) WHERE sentiment == \"positive\", negative = COUNT(*) WHERE sentiment == \"negative\", total = COUNT(*) BY product_category | SORT negative DESC | LIMIT 20",
    "params": {
      "lookback_days": {
        "type": "integer",
        "description": "Number of days to look back, e.g. 7, 30, 90"
      }
    }
  }
}
```

### Custom ES|QL Tool — Policy Compliance Check

`POST /api/agent_builder/tools`

```json
{
  "id": "policy_mention_search",
  "type": "esql",
  "description": "Counts how many feedback items mention a specific policy keyword. Use for compliance monitoring or to understand which policies generate the most customer friction.",
  "configuration": {
    "query": "FROM customer-feedback-* | WHERE MATCH(feedback_text, ?policy_keyword) | STATS mention_count = COUNT(*), avg_sentiment_score = AVG(sentiment_score) BY product_category | SORT mention_count DESC | LIMIT 15",
    "params": {
      "policy_keyword": {
        "type": "string",
        "description": "Policy term or keyword to search for, e.g. 'refund policy', 'cancellation', 'data privacy'"
      }
    }
  }
}
```

### Agent Definition

`POST /api/agent_builder/agents`

```json
{
  "id": "customer-feedback-agent",
  "name": "Customer Feedback Analyst",
  "description": "Analyzes customer sentiment, surfaces policy friction points, and provides product feedback trends.",
  "configuration": {
    "instructions": "You are a customer intelligence analyst. Always use tools to ground your responses in real data — do not answer from memory. For open questions about specific feedback, use customer_feedback_search. For trend analytics or policy mentions, use the ES|QL tools. When presenting findings, include counts and percentages where available.",
    "tools": [
      {
        "tool_ids": [
          "customer_feedback_search",
          "feedback_sentiment_trend",
          "policy_mention_search",
          "platform.core.search"
        ]
      }
    ]
  }
}
```

---

## 2. Marketing Campaign Analysis Agent

**Goal**: Analyze campaign performance, compare results across campaigns, and join campaign metadata with outcome data
using ES|QL LOOKUP JOIN.

**Key Tools**:

- `platform.core.search` — broad semantic retrieval across marketing indices
- Custom Index Search tool scoped to campaign description indices
- Custom ES|QL tools that join campaign description + results indices

### Custom Index Search Tool — Campaign Descriptions

`POST /api/agent_builder/tools`

```json
{
  "id": "campaign_description_search",
  "type": "index_search",
  "description": "Search marketing campaign descriptions, objectives, target audiences, and creative briefs. Use to understand what a campaign was about or find campaigns matching specific criteria.",
  "configuration": {
    "pattern": "marketing-campaigns-*"
  }
}
```

### Custom ES|QL Tool — Campaign Performance Join

`POST /api/agent_builder/tools`

```json
{
  "id": "campaign_performance_analysis",
  "type": "esql",
  "description": "Joins campaign descriptions with performance results to analyze ROI, conversion rates, and spend efficiency for campaigns in a given channel over a lookback period. Use when the user asks about campaign effectiveness, ROI, or performance comparisons.",
  "configuration": {
    "query": "FROM marketing-campaign-results-* | WHERE channel == ?channel AND @timestamp >= NOW() - ?lookback_days::integer * 1d | STATS total_spend = SUM(spend), total_conversions = SUM(conversions), total_impressions = SUM(impressions), avg_ctr = AVG(click_through_rate) BY campaign_id | LOOKUP JOIN marketing-campaigns-* ON campaign_id | EVAL roi = (total_conversions * ?revenue_per_conversion - total_spend) / total_spend * 100 | SORT roi DESC | LIMIT 10",
    "params": {
      "channel": {
        "type": "string",
        "description": "Marketing channel, e.g. 'email', 'social', 'paid_search', 'display'"
      },
      "lookback_days": {
        "type": "integer",
        "description": "Number of days to look back, e.g. 30, 90, 365"
      },
      "revenue_per_conversion": {
        "type": "float",
        "description": "Assumed revenue value per conversion for ROI calculation"
      }
    }
  }
}
```

### Custom ES|QL Tool — Audience Segment Performance

`POST /api/agent_builder/tools`

```json
{
  "id": "audience_segment_performance",
  "type": "esql",
  "description": "Analyzes which audience segments perform best for a given campaign. Use when the user asks about targeting effectiveness or audience insights.",
  "configuration": {
    "query": "FROM marketing-campaign-results-* | WHERE campaign_id == ?campaign_id | STATS conversions = SUM(conversions), spend = SUM(spend), impressions = SUM(impressions) BY audience_segment | EVAL cost_per_conversion = spend / conversions | SORT conversions DESC | LIMIT 15",
    "params": {
      "campaign_id": {
        "type": "string",
        "description": "The campaign ID to analyze"
      }
    }
  }
}
```

### Agent Definition

`POST /api/agent_builder/agents`

```json
{
  "id": "marketing-campaign-agent",
  "name": "Marketing Campaign Analyst",
  "description": "Analyzes marketing campaign effectiveness, compares ROI across campaigns and channels, and surfaces audience insights.",
  "configuration": {
    "instructions": "You are a marketing analytics expert. Always call tools for data — never answer from memory. For qualitative questions about what a campaign was about, use campaign_description_search. For performance metrics and ROI, use campaign_performance_analysis. For audience breakdowns, use audience_segment_performance. When showing results, present a concise summary with the most important metrics highlighted, then offer to drill down further.",
    "tools": [
      {
        "tool_ids": [
          "campaign_description_search",
          "campaign_performance_analysis",
          "audience_segment_performance",
          "platform.core.search"
        ]
      }
    ]
  }
}
```

---

## 3. Contract Analysis Agent

**Goal**: Search a large corpus of contracts for specific clause mentions, identify non-standard terms, and surface risk
patterns using hybrid search + ES|QL analytics.

**Key Design**: Hybrid search finds contracts with relevant clauses (using semantic + lexical matching). ES|QL tools
then extract and analyze specific term patterns across the corpus.

### Custom Index Search Tool — Contract Hybrid Search

`POST /api/agent_builder/tools`

```json
{
  "id": "contract_search",
  "type": "index_search",
  "description": "Searches the full contract corpus using hybrid search (semantic + keyword). Use to find contracts mentioning specific clauses, obligations, parties, or terms.",
  "configuration": {
    "pattern": "contracts-*"
  }
}
```

### Custom ES|QL Tool — Clause Frequency Analysis

`POST /api/agent_builder/tools`

```json
{
  "id": "clause_frequency_analysis",
  "type": "esql",
  "description": "Counts how many contracts contain a specific clause or term keyword, grouped by contract type or counterparty category. Use for corpus-wide analysis of how common a clause is.",
  "configuration": {
    "query": "FROM contracts-* | WHERE MATCH(contract_text, ?clause_keyword) | STATS contract_count = COUNT(*), counterparty_types = COUNT_DISTINCT(counterparty_category) BY contract_type | SORT contract_count DESC | LIMIT 20",
    "params": {
      "clause_keyword": {
        "type": "string",
        "description": "Clause or term to search for, e.g. 'limitation of liability', 'force majeure', 'auto-renewal'"
      }
    }
  }
}
```

### Custom ES|QL Tool — Liability Cap Outlier Detection

`POST /api/agent_builder/tools`

```json
{
  "id": "liability_cap_outliers",
  "type": "esql",
  "description": "Identifies contracts where the liability cap falls significantly above or below the norm for a given contract type. Use to find non-standard commercial terms that may need review.",
  "configuration": {
    "query": "FROM contracts-* | WHERE contract_type == ?contract_type | STATS median_val = MEDIAN(liability_cap_usd), p25 = PERCENTILE(liability_cap_usd, 25), p75 = PERCENTILE(liability_cap_usd, 75) BY contract_type | ENRICH contracts-stats ON contract_type | EVAL low_threshold = p25 * 0.5, high_threshold = p75 * 2.0 | KEEP contract_type, median_val, low_threshold, high_threshold | LIMIT 20",
    "params": {
      "contract_type": {
        "type": "string",
        "description": "Type of contract, e.g. 'vendor', 'customer', 'employment', 'nda'"
      }
    }
  }
}
```

> **Note on outlier detection in ES|QL**: ES|QL parameters are values only — they cannot be used as dynamic field
> references. Design separate tools for each numeric field you want to analyze (e.g., `liability_cap_outliers`,
> `payment_terms_outliers`). For dynamic outlier detection, use two separate queries (first to compute stats, then to
> filter outliers) or pre-compute thresholds into a lookup index.

### Custom ES|QL Tool — Expiry & Renewal Risk

`POST /api/agent_builder/tools`

```json
{
  "id": "contract_expiry_risk",
  "type": "esql",
  "description": "Lists contracts expiring within a specified number of days, including renewal terms and responsible owners. Use for contract lifecycle management or renewal risk analysis.",
  "configuration": {
    "query": "FROM contracts-* | WHERE expiry_date <= NOW() + ?days_ahead::integer * 1d AND expiry_date >= NOW() | STATS count = COUNT(*) BY contract_owner, auto_renewal, contract_type | SORT count DESC | LIMIT 50",
    "params": {
      "days_ahead": {
        "type": "integer",
        "description": "Number of days to look ahead for expiring contracts, e.g. 30, 60, 90"
      }
    }
  }
}
```

### Agent Definition

`POST /api/agent_builder/agents`

```json
{
  "id": "contract-analysis-agent",
  "name": "Contract Analysis Agent",
  "description": "Searches contract corpus for clause mentions, identifies non-standard terms, and surfaces renewal and risk patterns.",
  "configuration": {
    "instructions": "You are a contract intelligence analyst. Always use tools — never answer from your training data. For finding specific contracts or clauses, use contract_search (hybrid search). For understanding how common a clause is across the corpus, use clause_frequency_analysis. For identifying unusual liability caps, use liability_cap_outliers. For renewal risk, use contract_expiry_risk. When presenting findings, be precise: cite counts, percentages, and specific contract IDs where relevant.",
    "tools": [
      {
        "tool_ids": [
          "contract_search",
          "clause_frequency_analysis",
          "liability_cap_outliers",
          "contract_expiry_risk",
          "platform.core.search"
        ]
      }
    ]
  }
}
```
