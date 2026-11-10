/**
 * Radio callsigns ("telephony designators") of the airlines heard at the
 * airports we cover, mapped to the three-letter ICAO prefix ADS-B carries.
 *
 * A controller says "Brickyard 4512", the transponder says RPA4512: this
 * table is what joins the two. Keys are written the way speech recognition
 * tends to spell them; `telephonyKey` folds spaces and case so "Jet Blue",
 * "JetBlue" and "jetblue" all land on the same entry.
 */

/** ICAO prefix → every spoken form we accept for it. The first is the official one. */
export const TELEPHONY: Record<string, string[]> = {
  // United States: mainline
  AAL: ['American'],
  DAL: ['Delta'],
  UAL: ['United'],
  SWA: ['Southwest'],
  JBU: ['JetBlue', 'Jet Blue'],
  ASA: ['Alaska'],
  HAL: ['Hawaiian'],
  NKS: ['Spirit Wings', 'Spirit'],
  FFT: ['Frontier Flight', 'Frontier'],
  AAY: ['Allegiant'],
  SCX: ['Sun Country'],
  MXY: ['Moxy', 'Breeze'],
  VXP: ['Avelo'],
  // United States: regionals
  SKW: ['SkyWest', 'Sky West'],
  RPA: ['Brickyard', 'Brick Yard'],
  ENY: ['Envoy'],
  EDV: ['Endeavor', 'Endeavour'],
  PDT: ['Piedmont'],
  JIA: ['Blue Streak', 'Bluestreak'],
  ASH: ['Air Shuttle'],
  GJS: ['Lindbergh'],
  AWI: ['Wisconsin', 'Air Wisconsin'],
  UCA: ['Commutair', 'Commute Air'],
  QXE: ['Horizon'],
  CPZ: ['Compass'],
  AWE: ['Cactus'],
  SIL: ['Silver Wings', 'Silver'],
  KAP: ['Cair', 'Cape Air'],
  // United States: cargo and charter
  FDX: ['FedEx', 'Fed Ex', 'Federal Express'],
  UPS: ['UPS', 'U P S'],
  GTI: ['Giant'],
  ABX: ['Abex'],
  ATN: ['Air Transport'],
  CKS: ['Connie', 'Kalitta'],
  PAC: ['Polar Tiger', 'Polar'],
  AMF: ['Ameriflight'],
  SOO: ['Southern Air'],
  WGN: ['Western Global'],
  NCR: ['Northern Air Cargo'],
  OAE: ['Omni Express', 'Omni'],
  // Business aviation fleets
  EJA: ['Execjet', 'Exec Jet', 'NetJets'],
  LXJ: ['Flexjet', 'Flex Jet'],
  JRE: ['Jet Rider', 'Jetrider'],
  // Canada
  ACA: ['Air Canada'],
  JZA: ['Jazz'],
  ROU: ['Rouge'],
  WJA: ['WestJet', 'West Jet'],
  WEN: ['Encore'],
  WSW: ['Swoop'],
  FLE: ['Flair', 'Flare'],
  POE: ['Porter'],
  TSC: ['Air Transat', 'Transat'],
  SWG: ['Sunwing', 'Sun Wing'],
  CJT: ['Cargojet', 'Cargo Jet'],
  PCO: ['Pasco'],
  GLR: ['Glacier'],
  CAV: ['Calm Air'],
  ANT: ['Air North'],
  MAL: ['Morningstar', 'Morning Star'],
  KFA: ['Flightcraft'],
  PVL: ['Provincial'],
  // Mexico, Caribbean, Latin America
  AMX: ['Aeromexico', 'Aero Mexico'],
  VOI: ['Volaris'],
  VIV: ['Aerobus'],
  CMP: ['Copa'],
  AVA: ['Avianca'],
  LAN: ['LAN', 'Lan Chile'],
  TAM: ['TAM'],
  LPE: ['Lan Peru'],
  ARG: ['Argentina'],
  BWA: ['West Indian', 'Caribbean'],
  BHS: ['Bahamas'],
  // Europe
  BAW: ['Speedbird', 'Speed Bird'],
  VIR: ['Virgin'],
  AFR: ['Air France', 'Airfrans'],
  KLM: ['KLM', 'K L M'],
  DLH: ['Lufthansa'],
  IBE: ['Iberia'],
  EIN: ['Shamrock'],
  SWR: ['Swiss'],
  AUA: ['Austrian'],
  SAS: ['Scandinavian'],
  FIN: ['Finnair'],
  ICE: ['Iceair', 'Ice Air'],
  TAP: ['Air Portugal'],
  ITY: ['Itarrow'],
  CFG: ['Condor'],
  EDW: ['Edelweiss'],
  NOZ: ['Nordic'],
  NBT: ['Norse'],
  LOT: ['Lot', 'Pollot'],
  BEL: ['Beeline'],
  THY: ['Turkish'],
  // Middle East, Africa, Asia, Pacific
  UAE: ['Emirates'],
  ETD: ['Etihad'],
  QTR: ['Qatari'],
  SVA: ['Saudia'],
  // "Tell Al": how the recogniser wrote El Al at Kennedy.
  ELY: ['El Al', 'Elal', 'Tell Al'],
  AIZ: ['Arkia'],
  RJA: ['Jordanian'],
  ETH: ['Ethiopian'],
  RAM: ['Royal Air Maroc'],
  MSR: ['Egyptair', 'Egypt Air'],
  AIC: ['Air India'],
  JAL: ['Japan Air'],
  ANA: ['All Nippon'],
  KAL: ['Korean Air'],
  AAR: ['Asiana'],
  CPA: ['Cathay'],
  CCA: ['Air China'],
  CES: ['China Eastern'],
  CSN: ['China Southern'],
  CAL: ['Dynasty'],
  EVA: ['Eva', 'Eva Air'],
  SIA: ['Singapore'],
  PAL: ['Philippine'],
  QFA: ['Qantas'],
  ANZ: ['New Zealand'],
}

/** Fold a spoken name for lookup: lowercase, letters only. */
export function telephonyKey(spoken: string): string {
  return spoken.toLowerCase().replace(/[^a-z]/g, '')
}

/** Folded spoken form → ICAO prefix. */
export const SPOKEN_TO_PREFIX: ReadonlyMap<string, string> = new Map(
  Object.entries(TELEPHONY).flatMap(([prefix, names]) => names.map((n) => [telephonyKey(n), prefix] as const)),
)

/** Longest spoken telephony, in words, so the parser knows how far ahead to look. */
export const MAX_TELEPHONY_WORDS = Math.max(...Object.values(TELEPHONY).flat().map((n) => n.split(/\s+/).length))

/** Official spoken name for a prefix ("RPA" → "Brickyard"), for the prompt that steers transcription. */
export function spokenAirline(prefix: string): string | null {
  return TELEPHONY[prefix.toUpperCase()]?.[0] ?? null
}
