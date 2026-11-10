/**
 * Mount points for the insight features in the app shell. `InsightsOverlay`
 * sits with the map's floating chrome (it runs the alert rules, the briefing
 * schedule and the return-to-app watch, and shows alert cards);
 * `InsightsModals` holds the sheets and the term explanation.
 */
import { GlossarySheet } from '../learn/GlossarySheet'
import { TermPopover } from '../learn/TermPopover'
import { AlertStack } from './AlertStack'
import { useAlertsEngine } from './alertsRunner'
import { CatchUpSheet } from './CatchUp'
import { useBriefingSchedule, useCatchUpWatch } from './hooks'

export function InsightsOverlay() {
  useAlertsEngine()
  useBriefingSchedule()
  useCatchUpWatch()
  return <AlertStack />
}

export function InsightsModals() {
  return (
    <>
      <CatchUpSheet />
      <GlossarySheet />
      <TermPopover />
    </>
  )
}
