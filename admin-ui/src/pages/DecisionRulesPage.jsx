import StopFactorsPage from './StopFactorsPage'

export default function DecisionRulesPage({ canEdit }) {
  return (
    <StopFactorsPage
      canEdit={canEdit}
      forcedStage="decision"
      showStageTabs={false}
      title="Flowable decision rules"
      intro="These rules run only inside the Flowable decision-service after external reports are collected. You can point rules at parsed values like result.parsed_report.summary.credit_score or raw provider payloads like result.steps.isoftpull.creditScore."
      addLabel="+ Add decision rule"
      fieldPathPlaceholder="result.parsed_report.summary.credit_score or result.steps.isoftpull.creditScore"
    />
  )
}
