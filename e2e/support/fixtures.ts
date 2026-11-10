/**
 * Aircraft in the recorded JFK snapshot that the tests name. They are the
 * hand-placed ones from e2e/record-fixtures.mjs (plus one real taxiing jet),
 * so a re-recording keeps them.
 */
export const JFK = {
  /** On a four-mile final for runway 31R. */
  arrival: { icao24: 'a4f2c1', callsign: 'DAL1210', type: 'A321' },
  /** Climbing out off 31L. */
  departure: { icao24: 'aa0b5e', callsign: 'AAL100', type: 'B77W' },
  /** Over Jamaica Bay. */
  helicopter: { icao24: 'a2c7f0', callsign: 'N24HL', type: 'AS50', drawing: /helicopter|AS ?350|Écureuil|Squirrel/i },
  /** VFR along the beach. */
  light: { icao24: 'a9d3b2', callsign: 'N738SP', type: 'C172', drawing: /Cessna|172|Skyhawk/i },
  /** Taxiing at 14 kt. */
  taxiing: { icao24: 'a05b7e', callsign: 'DAL2692', type: 'BCS1' },
  /** Parked at the JetBlue terminal; the stubbed radio calls name it. */
  parked: { icao24: 'a1de8d', callsign: 'JBU924', type: 'A21N' },
} as const
