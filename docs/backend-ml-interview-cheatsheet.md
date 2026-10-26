# EVOLT Backend & ML Interview Cheat Sheet

## 30-second project explanation

EVOLT is a Next.js + PostgreSQL EV-charging intelligence platform. It imports charging-session and charger-health data, stores it in PostgreSQL, analyzes connector health, trains explainable classification models, creates evidence-backed company action items, and ranks chargers for drivers.

The project combines:

- **Supervised ML** for charging-session classification.
- **Statistical analysis** for connector health and service forecasts.
- **Deterministic rules** for driver ranking and company action items.

---

## Where is the model?

```text
src/features/learning/models.ts
```

This file contains the actual algorithms:

- Majority-class baseline
- Explainable threshold classifier
- Multinomial logistic regression
- Prediction functions
- Stratified folds
- Confusion matrix and precision/recall/F1 metrics

The training pipeline is here:

```text
src/features/learning/train.ts
```

The database-connected ML service is here:

```text
src/features/learning/service.ts
```

The generated offline model report is here:

```text
models/session-models.json
```

---

## What ML target is being predicted?

The main target is:

```text
reduced_power_loss_category
```

It has three classes:

```text
Low, Medium, High
```

The target describes the measured power loss of a charging session. It does **not** mean that the model is predicting a future charger failure.

For the supplied dataset, the learned rule is approximately:

```text
power_loss <= 1.88 kW       -> Low
1.88 < power_loss <= 3.67    -> Medium
power_loss > 3.67 kW         -> High
```

The category is therefore a severity classification of an existing measurement.

---

## Why is the accuracy high?

The recorded `power_loss` value contains most of the information needed to determine the label.

Results on the supplied 1,000-session dataset:

| Approach | Accuracy |
|---|---:|
| Always predict the most common class | 37.4% |
| Explainable threshold model | 91.7% |
| Multinomial logistic regression | 91.9% |

When `power_loss` is removed, accuracy falls to about 37%, which is effectively the baseline. Therefore:

> The model is very good at consistently categorizing a measured power-loss value, but it is not reliably forecasting power loss from unrelated fields.

---

## Which model is actually selected?

The project evaluates both threshold classification and logistic regression.

- Logistic regression achieved the highest score: **91.9%**.
- The threshold model achieved **91.7%**.
- The difference is only **0.2 percentage points**.

EVOLT selects the threshold model because it is within one percentage point of the best model and is easier to explain:

```text
if power_loss <= 1.88:
    Low
else if power_loss <= 3.67:
    Medium
else:
    High
```

Correct interview statement:

> Logistic regression is part of the evaluated ML pipeline and achieves 91.9%, but the selected final model is the explainable threshold model at 91.7%.

---

## ML training pipeline

```text
CSV / JSON session data
        |
        v
Parse and detect file type
        |
        v
Map uploaded columns to EVOLT fields
        |
        v
Validate, normalize, and remove duplicates
        |
        v
Store sessions in PostgreSQL
        |
        v
Build numeric and one-hot encoded features
        |
        v
Remove identifier fields such as IDs
        |
        v
Create stratified 5-fold splits
        |
        v
Evaluate baseline, threshold, and logistic regression
        |
        v
Check whether the target beats guessing
        |
        v
Select and fit the final model
        |
        v
Store report in model_runs / session-models.json
        |
        v
Serve predictions through /api/models/predict
```

Training commands:

```bash
npm run model:train
npm run model:train -- path/to/sessions.csv
```

Runtime retraining endpoint:

```text
POST /api/models/train
```

---

## ML files and their roles

| File | Role |
|---|---|
| `src/features/learning/models.ts` | Algorithms and evaluation utilities |
| `src/features/learning/train.ts` | Feature building, cross-validation, model selection, final fitting |
| `src/features/learning/service.ts` | Reads sessions, saves reports, performs predictions |
| `src/features/learning/types.ts` | Model and report TypeScript types |
| `scripts/train-model.ts` | Reproducible offline training CLI |
| `models/session-models.json` | Generated model report and fitted artifact |
| `src/app/api/models/route.ts` | Reads latest model reports |
| `src/app/api/models/train/route.ts` | Protected retraining endpoint |
| `src/app/api/models/predict/route.ts` | Prediction endpoint |
| `src/lib/db/schema.ts` | Defines `charging_sessions` and `model_runs` tables |

---

## Full project pipeline

### 1. Data ingestion

```text
CSV / JSON upload
-> parse
-> detect dataset kind
-> map columns
-> validate rows
-> normalize values and timestamps
-> detect duplicates
-> insert in a database transaction
```

Main location:

```text
src/features/data-ingestion/
```

Important files:

- `parse.ts` - reads CSV/JSON
- `fields.ts` - suggests column mappings
- `normalize.ts` - normalizes values
- `plan.ts` - validates and plans rows
- `service.ts` - coordinates database import

### 2. Connector-health analysis

```text
Health observations
-> validate readings
-> calculate charger-specific baseline
-> correct temperature when possible
-> detect persistent deviations and trends
-> create or update alerts
```

Main locations:

```text
src/features/anomaly-detection/
src/features/connector-health/
```

This is statistical analysis, not the logistic-regression classifier.

### 3. Company action items

```text
Sessions and observations
-> calculate metrics
-> apply evidence-based rules
-> assign priority
-> show evidence, reason, and next action
```

Main location:

```text
src/features/insights/
```

Important file:

```text
src/features/insights/rules.ts
```

### 4. Driver ranking

```text
Driver requirements
-> apply radius and connector filters
-> remove offline/incompatible chargers
-> rank by health, availability, distance, and power
-> generate explanation
```

This is deterministic ranking, not ML.

Main location:

```text
src/features/recommendations/
```

---

## Important database tables

Defined in:

```text
src/lib/db/schema.ts
```

| Table | Purpose |
|---|---|
| `dataset_imports` | Tracks files, hashes, accepted/rejected rows |
| `stations` | Station identity and location |
| `chargers` | Connector, power, status, and health summary |
| `health_observations` | Time-series charger readings |
| `charging_sessions` | ML training rows, numeric values, and labels |
| `model_runs` | Cross-validation reports and fitted models |
| `alerts` | Health alerts and evidence |
| `maintenance_events` | Recorded repair/maintenance work |
| `insight_reviews` | Reviewed, resolved, or dismissed action items |

---

## Interview answers

### Where is the model?

> `src/features/learning/models.ts` contains the algorithms. `train.ts` orchestrates training and cross-validation. `service.ts` connects ML to PostgreSQL and inference. Model reports are stored in `model_runs` and exported to `models/session-models.json` by the training script.

### Where is logistic regression?

> It is implemented manually in `src/features/learning/models.ts` through `fitLogistic()` and `predictLogistic()`. It standardizes features, trains multiclass weights with gradient updates and L2 regularization, and predicts the class with the highest score.

### What does 91.9% mean?

> It means logistic regression correctly classified the Low, Medium, or High power-loss category for about 91.9% of unseen validation sessions. It is not a 91.9% prediction of charger failure.

### Why is the score high?

> The target label is strongly determined by the recorded `power_loss` feature. Removing that feature reduces performance to approximately the 37.4% guessing baseline.

### Is logistic regression the production model?

> It is the best evaluated model at 91.9%, but the selected final model is the explainable threshold model at 91.7% because the accuracy difference is only 0.2 points.

### Is everything in EVOLT ML?

> No. Session categorization uses supervised ML. Connector health and forecasts use robust statistics. Driver ranking and company action items use deterministic, evidence-backed rules.

---

## One-minute final explanation

> EVOLT imports charging sessions and charger observations into PostgreSQL. The ML code is under `src/features/learning`: `models.ts` contains the algorithms, `train.ts` runs feature engineering and stratified five-fold cross-validation, and `service.ts` stores reports and performs inference. For the supplied data, the project classifies measured power loss into Low, Medium, and High categories. Logistic regression reaches 91.9% accuracy, while an explainable threshold model reaches 91.7% and is selected because it gives nearly the same result with a transparent rule. Other pipelines handle data ingestion, connector-health statistics, service forecasts, company action items, and deterministic driver recommendations.
