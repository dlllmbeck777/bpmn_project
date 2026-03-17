import StopFactorsPage from './StopFactorsPage'

export default function DecisionRulesPage({ canEdit }) {
  return (
    <StopFactorsPage
      canEdit={canEdit}
      forcedStage="decision"
      showStageTabs={false}
      title="Flowable decision rules"
      intro="These rules run only inside the Flowable decision-service after external reports are collected. A decision rule is a pass condition: the request continues while field_path operator threshold stays true, and Action on fail is triggered only when that check becomes false. Example: result.parsed_report.summary.credit_score gte 500 means reject only when the score is below 500."
      addLabel="+ Add decision rule"
      fieldPathPlaceholder="result.parsed_report.summary.credit_score or result.steps.isoftpull.creditScore"
    />
  )
}
