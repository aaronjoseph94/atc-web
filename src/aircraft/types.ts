/**
 * Facts about common aircraft types, keyed by ICAO type designator, for the
 * flight view. Figures are the manufacturers' published specifications,
 * rounded; a field is left out rather than guessed when it varies a lot
 * between versions or isn't well established. `firstFlight` is the year of the
 * first flight of that model (or its series where noted in the name).
 */
import { shapeForCategory, shapeForType } from './classify'
import type { ShapeId } from './shapes'

export type EngineKind = 'turbofan' | 'turboprop' | 'piston' | 'turboshaft'

export type TypeFacts = {
  /** Marketing name, e.g. "737-800". */
  name: string
  manufacturer: string
  /** Short description of the kind of aircraft. */
  kind: string
  engines: { count: number; type: EngineKind }
  /** Wingspan (rotor diameter for helicopters), metres. */
  spanM?: number
  lengthM?: number
  /** Typical seating, as published ("162–189", "up to 19"). */
  seats?: string
  rangeNm?: number
  /** Typical cruise: Mach for jets, knots for the rest. */
  cruise?: { mach: number } | { kt: number }
  firstFlight?: number
}

const jet = (n: number) => ({ count: n, type: 'turbofan' as const })
const prop = (n: number) => ({ count: n, type: 'turboprop' as const })
const piston = (n: number) => ({ count: n, type: 'piston' as const })
const shaft = (n: number) => ({ count: n, type: 'turboshaft' as const })

const NARROW = 'Narrow-body airliner'
const WIDE = 'Wide-body airliner'
const REGIONAL = 'Regional jet'
const BIZ = 'Business jet'
const TPROP = 'Turboprop airliner'

export const TYPES: Record<string, TypeFacts> = {
  // ---- Airbus ----------------------------------------------------------------
  A319: { name: 'A319', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 33.8, seats: '124–156', rangeNm: 3700, cruise: { mach: 0.78 }, firstFlight: 1995 },
  A320: { name: 'A320', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 37.6, seats: '150–180', rangeNm: 3300, cruise: { mach: 0.78 }, firstFlight: 1987 },
  A321: { name: 'A321', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 44.5, seats: '185–220', cruise: { mach: 0.78 }, firstFlight: 1993 },
  A19N: { name: 'A319neo', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 33.8, seats: '120–150', cruise: { mach: 0.78 }, firstFlight: 2017 },
  A20N: { name: 'A320neo', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 37.6, seats: '150–180', rangeNm: 3400, cruise: { mach: 0.78 }, firstFlight: 2014 },
  A21N: { name: 'A321neo', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 44.5, seats: '180–220', rangeNm: 4000, cruise: { mach: 0.78 }, firstFlight: 2016 },
  BCS1: { name: 'A220-100', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.1, lengthM: 35.0, seats: '100–120', cruise: { mach: 0.78 }, firstFlight: 2013 },
  BCS3: { name: 'A220-300', manufacturer: 'Airbus', kind: NARROW, engines: jet(2), spanM: 35.1, lengthM: 38.7, seats: '120–150', cruise: { mach: 0.78 }, firstFlight: 2015 },
  A332: { name: 'A330-200', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 60.3, lengthM: 58.8, seats: '210–250', rangeNm: 7250, cruise: { mach: 0.82 }, firstFlight: 1997 },
  A333: { name: 'A330-300', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 60.3, lengthM: 63.7, seats: '250–300', rangeNm: 6350, cruise: { mach: 0.82 }, firstFlight: 1992 },
  A338: { name: 'A330-800', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 64.0, lengthM: 58.8, seats: '220–260', rangeNm: 8150, cruise: { mach: 0.82 }, firstFlight: 2018 },
  A339: { name: 'A330-900', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 64.0, lengthM: 63.7, seats: '260–300', rangeNm: 7200, cruise: { mach: 0.82 }, firstFlight: 2017 },
  A343: { name: 'A340-300', manufacturer: 'Airbus', kind: WIDE, engines: jet(4), spanM: 60.3, lengthM: 63.7, cruise: { mach: 0.82 }, firstFlight: 1991 },
  A346: { name: 'A340-600', manufacturer: 'Airbus', kind: WIDE, engines: jet(4), spanM: 63.5, lengthM: 75.4, cruise: { mach: 0.83 }, firstFlight: 2001 },
  A359: { name: 'A350-900', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 64.8, lengthM: 66.8, seats: '300–350', rangeNm: 8100, cruise: { mach: 0.85 }, firstFlight: 2013 },
  A35K: { name: 'A350-1000', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 64.8, lengthM: 73.8, seats: '350–410', rangeNm: 8700, cruise: { mach: 0.85 }, firstFlight: 2016 },
  A388: { name: 'A380', manufacturer: 'Airbus', kind: 'Double-deck wide-body airliner', engines: jet(4), spanM: 79.8, lengthM: 72.7, seats: '500–600', rangeNm: 8000, cruise: { mach: 0.85 }, firstFlight: 2005 },

  // ---- Boeing ----------------------------------------------------------------
  B712: { name: '717', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 28.4, lengthM: 37.8, seats: '106–117', firstFlight: 1998 },
  B736: { name: '737-600', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 34.3, lengthM: 31.2, cruise: { mach: 0.785 }, firstFlight: 1998 },
  B737: { name: '737-700', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 33.6, seats: '126–149', rangeNm: 3000, cruise: { mach: 0.785 }, firstFlight: 1997 },
  B738: { name: '737-800', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 39.5, seats: '162–189', rangeNm: 2900, cruise: { mach: 0.785 }, firstFlight: 1997 },
  B739: { name: '737-900', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.8, lengthM: 42.1, seats: '178–220', cruise: { mach: 0.785 }, firstFlight: 2000 },
  B37M: { name: '737 MAX 7', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.9, lengthM: 35.6, seats: '138–153', cruise: { mach: 0.79 }, firstFlight: 2018 },
  B38M: { name: '737 MAX 8', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.9, lengthM: 39.5, seats: '162–178', rangeNm: 3500, cruise: { mach: 0.79 }, firstFlight: 2016 },
  B39M: { name: '737 MAX 9', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.9, lengthM: 42.2, seats: '178–193', cruise: { mach: 0.79 }, firstFlight: 2017 },
  B3XM: { name: '737 MAX 10', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 35.9, lengthM: 43.8, seats: '188–204', cruise: { mach: 0.79 }, firstFlight: 2021 },
  B752: { name: '757-200', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 38.0, lengthM: 47.3, seats: '200–228', rangeNm: 3900, cruise: { mach: 0.8 }, firstFlight: 1982 },
  B753: { name: '757-300', manufacturer: 'Boeing', kind: NARROW, engines: jet(2), spanM: 38.0, lengthM: 54.4, seats: '243–280', cruise: { mach: 0.8 }, firstFlight: 1998 },
  B762: { name: '767-200', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 47.6, lengthM: 48.5, cruise: { mach: 0.8 }, firstFlight: 1981 },
  B763: { name: '767-300', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 47.6, lengthM: 54.9, seats: '218–269', cruise: { mach: 0.8 }, firstFlight: 1986 },
  B764: { name: '767-400ER', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 51.9, lengthM: 61.4, seats: '245–304', cruise: { mach: 0.8 }, firstFlight: 1999 },
  B772: { name: '777-200', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 60.9, lengthM: 63.7, cruise: { mach: 0.84 }, firstFlight: 1994 },
  B77L: { name: '777-200LR / 777F', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 64.8, lengthM: 63.7, cruise: { mach: 0.84 }, firstFlight: 2005 },
  B773: { name: '777-300', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 60.9, lengthM: 73.9, cruise: { mach: 0.84 }, firstFlight: 1997 },
  B77W: { name: '777-300ER', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 64.8, lengthM: 73.9, seats: '350–400', rangeNm: 7370, cruise: { mach: 0.84 }, firstFlight: 2003 },
  B779: { name: '777-9', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 71.8, lengthM: 76.7, seats: '426', cruise: { mach: 0.84 }, firstFlight: 2020 },
  B788: { name: '787-8 Dreamliner', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 60.1, lengthM: 56.7, seats: '240–250', rangeNm: 7300, cruise: { mach: 0.85 }, firstFlight: 2009 },
  B789: { name: '787-9 Dreamliner', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 60.1, lengthM: 62.8, seats: '290–300', rangeNm: 7550, cruise: { mach: 0.85 }, firstFlight: 2013 },
  B78X: { name: '787-10 Dreamliner', manufacturer: 'Boeing', kind: WIDE, engines: jet(2), spanM: 60.1, lengthM: 68.3, seats: '330–340', rangeNm: 6350, cruise: { mach: 0.85 }, firstFlight: 2017 },
  B744: { name: '747-400', manufacturer: 'Boeing', kind: WIDE, engines: jet(4), spanM: 64.4, lengthM: 70.7, seats: '400–420', cruise: { mach: 0.85 }, firstFlight: 1988 },
  B748: { name: '747-8', manufacturer: 'Boeing', kind: WIDE, engines: jet(4), spanM: 68.4, lengthM: 76.3, seats: '410', cruise: { mach: 0.855 }, firstFlight: 2010 },

  // ---- Regional jets -----------------------------------------------------------
  CRJ2: { name: 'CRJ200', manufacturer: 'Bombardier', kind: REGIONAL, engines: jet(2), spanM: 21.2, lengthM: 26.8, seats: '50' },
  CRJ7: { name: 'CRJ700', manufacturer: 'Bombardier', kind: REGIONAL, engines: jet(2), spanM: 23.2, lengthM: 32.3, seats: '66–78', firstFlight: 1999 },
  CRJ9: { name: 'CRJ900', manufacturer: 'Bombardier', kind: REGIONAL, engines: jet(2), spanM: 24.9, lengthM: 36.2, seats: '76–90', firstFlight: 2001 },
  E135: { name: 'ERJ 135', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 20.0, lengthM: 26.3, seats: '37', firstFlight: 1998 },
  E145: { name: 'ERJ 145', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 20.0, lengthM: 29.9, seats: '50', firstFlight: 1995 },
  E170: { name: 'E170', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 26.0, lengthM: 29.9, seats: '66–78', firstFlight: 2002 },
  E75L: { name: 'E175', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 26.0, lengthM: 31.7, seats: '76–88', firstFlight: 2003 },
  E75S: { name: 'E175', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 26.0, lengthM: 31.7, seats: '76–88', firstFlight: 2003 },
  E190: { name: 'E190', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 28.7, lengthM: 36.2, seats: '96–114', firstFlight: 2004 },
  E195: { name: 'E195', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 28.7, lengthM: 38.7, seats: '100–124', firstFlight: 2004 },
  E290: { name: 'E190-E2', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 33.7, lengthM: 36.2, seats: '96–114', firstFlight: 2016 },
  E295: { name: 'E195-E2', manufacturer: 'Embraer', kind: REGIONAL, engines: jet(2), spanM: 35.1, lengthM: 41.5, seats: '120–146', firstFlight: 2017 },

  // ---- Turboprops ----------------------------------------------------------------
  DH8A: { name: 'Dash 8-100', manufacturer: 'De Havilland Canada', kind: TPROP, engines: prop(2), spanM: 25.9, lengthM: 22.3, seats: '37–39', firstFlight: 1983 },
  DH8C: { name: 'Dash 8-300', manufacturer: 'De Havilland Canada', kind: TPROP, engines: prop(2), spanM: 27.4, lengthM: 25.7, seats: '50–56', firstFlight: 1987 },
  DH8D: { name: 'Dash 8-400', manufacturer: 'De Havilland Canada', kind: TPROP, engines: prop(2), spanM: 28.4, lengthM: 32.8, seats: '68–90', cruise: { kt: 360 }, firstFlight: 1998 },
  AT43: { name: 'ATR 42', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 24.6, lengthM: 22.7, seats: '30–50', firstFlight: 1984 },
  AT45: { name: 'ATR 42-500', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 24.6, lengthM: 22.7, seats: '30–50', firstFlight: 1984 },
  AT46: { name: 'ATR 42-600', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 24.6, lengthM: 22.7, seats: '30–50', firstFlight: 1984 },
  AT72: { name: 'ATR 72', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 27.1, lengthM: 27.2, seats: '68–78', firstFlight: 1988 },
  AT75: { name: 'ATR 72-500', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 27.1, lengthM: 27.2, seats: '68–78', firstFlight: 1988 },
  AT76: { name: 'ATR 72-600', manufacturer: 'ATR', kind: TPROP, engines: prop(2), spanM: 27.1, lengthM: 27.2, seats: '68–78', firstFlight: 1988 },
  SF34: { name: '340', manufacturer: 'Saab', kind: TPROP, engines: prop(2), spanM: 21.4, lengthM: 19.7, seats: '34–37', firstFlight: 1983 },
  B190: { name: '1900', manufacturer: 'Beechcraft', kind: TPROP, engines: prop(2), spanM: 17.7, lengthM: 17.6, seats: '19', firstFlight: 1982 },
  BE20: { name: 'King Air 200', manufacturer: 'Beechcraft', kind: 'Twin turboprop', engines: prop(2), spanM: 16.6, lengthM: 13.3, firstFlight: 1972 },
  DHC6: { name: 'Twin Otter', manufacturer: 'De Havilland Canada', kind: 'Utility turboprop', engines: prop(2), spanM: 19.8, lengthM: 15.8, seats: '19', firstFlight: 1965 },
  PC12: { name: 'PC-12', manufacturer: 'Pilatus', kind: 'Single turboprop', engines: prop(1), spanM: 16.3, lengthM: 14.4, seats: '6–9', firstFlight: 1991 },
  C208: { name: '208 Caravan', manufacturer: 'Cessna', kind: 'Single turboprop', engines: prop(1), spanM: 15.9, firstFlight: 1982 },

  // ---- Business jets -------------------------------------------------------------
  C56X: { name: 'Citation Excel / XLS', manufacturer: 'Cessna', kind: BIZ, engines: jet(2), spanM: 17.2, lengthM: 15.8, seats: '9–12', firstFlight: 1996 },
  C68A: { name: 'Citation Latitude', manufacturer: 'Cessna', kind: BIZ, engines: jet(2), spanM: 22.0, lengthM: 19.0, seats: 'up to 9', firstFlight: 2014 },
  C750: { name: 'Citation X', manufacturer: 'Cessna', kind: BIZ, engines: jet(2), spanM: 19.4, lengthM: 22.0, seats: 'up to 12', firstFlight: 1993 },
  C25B: { name: 'Citation CJ3', manufacturer: 'Cessna', kind: BIZ, engines: jet(2), spanM: 16.3, lengthM: 15.6, seats: 'up to 9', firstFlight: 2003 },
  CL30: { name: 'Challenger 300', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 19.5, lengthM: 20.9, seats: 'up to 10', firstFlight: 2001 },
  CL60: { name: 'Challenger 600 series', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 19.6, lengthM: 20.9, seats: 'up to 12', firstFlight: 1978 },
  GLEX: { name: 'Global Express / 6000', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 28.7, lengthM: 30.3, seats: '13–17', rangeNm: 6000, cruise: { mach: 0.85 }, firstFlight: 1996 },
  GL5T: { name: 'Global 5000 / 5500', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 28.7, lengthM: 29.5, seats: 'up to 16', cruise: { mach: 0.85 }, firstFlight: 2003 },
  GL7T: { name: 'Global 7500', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 31.7, lengthM: 33.8, seats: 'up to 19', rangeNm: 7700, cruise: { mach: 0.85 }, firstFlight: 2016 },
  GLF4: { name: 'Gulfstream IV / G450', manufacturer: 'Gulfstream', kind: BIZ, engines: jet(2), spanM: 23.7, lengthM: 26.9, seats: 'up to 16', firstFlight: 1985 },
  GLF5: { name: 'Gulfstream V / G550', manufacturer: 'Gulfstream', kind: BIZ, engines: jet(2), spanM: 28.5, lengthM: 29.4, seats: 'up to 19', rangeNm: 6750, cruise: { mach: 0.8 }, firstFlight: 1995 },
  GLF6: { name: 'G650', manufacturer: 'Gulfstream', kind: BIZ, engines: jet(2), spanM: 30.4, lengthM: 30.4, seats: 'up to 19', rangeNm: 7000, cruise: { mach: 0.85 }, firstFlight: 2009 },
  GA7C: { name: 'G700', manufacturer: 'Gulfstream', kind: BIZ, engines: jet(2), spanM: 31.4, lengthM: 33.5, seats: 'up to 19', cruise: { mach: 0.85 }, firstFlight: 2020 },
  G280: { name: 'G280', manufacturer: 'Gulfstream', kind: BIZ, engines: jet(2), spanM: 19.2, lengthM: 20.4, seats: 'up to 10', firstFlight: 2009 },
  LJ45: { name: 'Learjet 45', manufacturer: 'Bombardier', kind: BIZ, engines: jet(2), spanM: 14.6, lengthM: 17.7, seats: 'up to 9', firstFlight: 1995 },
  F2TH: { name: 'Falcon 2000', manufacturer: 'Dassault', kind: BIZ, engines: jet(2), spanM: 19.3, lengthM: 20.2, seats: 'up to 10', firstFlight: 1993 },
  FA7X: { name: 'Falcon 7X', manufacturer: 'Dassault', kind: BIZ, engines: jet(3), spanM: 26.2, lengthM: 23.2, seats: 'up to 16', firstFlight: 2005 },
  F900: { name: 'Falcon 900', manufacturer: 'Dassault', kind: BIZ, engines: jet(3), spanM: 19.3, lengthM: 20.2, seats: 'up to 14', firstFlight: 1984 },
  E55P: { name: 'Phenom 300', manufacturer: 'Embraer', kind: BIZ, engines: jet(2), spanM: 16.2, lengthM: 15.6, seats: 'up to 10', firstFlight: 2008 },
  PC24: { name: 'PC-24', manufacturer: 'Pilatus', kind: BIZ, engines: jet(2), spanM: 17.0, lengthM: 16.9, seats: 'up to 10', firstFlight: 2015 },

  // ---- Light aircraft --------------------------------------------------------------
  C152: { name: '152', manufacturer: 'Cessna', kind: 'Two-seat trainer', engines: piston(1), spanM: 10.2, lengthM: 7.3, seats: '2' },
  C172: { name: '172 Skyhawk', manufacturer: 'Cessna', kind: 'Light single', engines: piston(1), spanM: 11.0, lengthM: 8.3, seats: '4', rangeNm: 640, cruise: { kt: 124 }, firstFlight: 1955 },
  C182: { name: '182 Skylane', manufacturer: 'Cessna', kind: 'Light single', engines: piston(1), spanM: 11.0, lengthM: 8.8, seats: '4' },
  C206: { name: '206 Stationair', manufacturer: 'Cessna', kind: 'Light single', engines: piston(1), spanM: 11.0, lengthM: 8.6, seats: '6' },
  P28A: { name: 'PA-28 Cherokee', manufacturer: 'Piper', kind: 'Light single', engines: piston(1), spanM: 10.7, lengthM: 7.3, seats: '4', firstFlight: 1960 },
  SR20: { name: 'SR20', manufacturer: 'Cirrus', kind: 'Light single', engines: piston(1), spanM: 11.7, lengthM: 7.9, seats: '4–5', firstFlight: 1995 },
  SR22: { name: 'SR22', manufacturer: 'Cirrus', kind: 'Light single', engines: piston(1), spanM: 11.7, lengthM: 7.9, seats: '4–5' },
  DA40: { name: 'DA40', manufacturer: 'Diamond', kind: 'Light single', engines: piston(1), spanM: 11.6, lengthM: 8.1, seats: '4', firstFlight: 1997 },
  DA42: { name: 'DA42 Twin Star', manufacturer: 'Diamond', kind: 'Light twin', engines: piston(2), spanM: 13.4, lengthM: 8.6, seats: '4', firstFlight: 2002 },
  BE36: { name: 'Bonanza A36', manufacturer: 'Beechcraft', kind: 'Light single', engines: piston(1), spanM: 10.2, lengthM: 8.4, seats: '6' },
  BE58: { name: 'Baron 58', manufacturer: 'Beechcraft', kind: 'Light twin', engines: piston(2), spanM: 11.5, lengthM: 9.1, seats: '6' },
  PA34: { name: 'PA-34 Seneca', manufacturer: 'Piper', kind: 'Light twin', engines: piston(2), spanM: 11.9, lengthM: 8.7, seats: '6' },
  C310: { name: '310', manufacturer: 'Cessna', kind: 'Light twin', engines: piston(2), seats: '6' },

  // ---- Helicopters ------------------------------------------------------------------
  R22: { name: 'R22', manufacturer: 'Robinson', kind: 'Light helicopter', engines: piston(1), spanM: 7.7, lengthM: 8.8, seats: '2', firstFlight: 1975 },
  R44: { name: 'R44', manufacturer: 'Robinson', kind: 'Light helicopter', engines: piston(1), spanM: 10.1, lengthM: 11.7, seats: '4', firstFlight: 1990 },
  R66: { name: 'R66', manufacturer: 'Robinson', kind: 'Light helicopter', engines: shaft(1), spanM: 10.1, seats: '5' },
  AS50: { name: 'H125 / AStar', manufacturer: 'Airbus Helicopters', kind: 'Light helicopter', engines: shaft(1), spanM: 10.7, lengthM: 12.9, seats: 'up to 6', firstFlight: 1974 },
  EC35: { name: 'H135', manufacturer: 'Airbus Helicopters', kind: 'Light twin helicopter', engines: shaft(2), spanM: 10.2, lengthM: 12.2, seats: 'up to 7', firstFlight: 1994 },
  EC45: { name: 'H145', manufacturer: 'Airbus Helicopters', kind: 'Light twin helicopter', engines: shaft(2), spanM: 11.0, lengthM: 13.6, seats: 'up to 10' },
  B06: { name: '206 JetRanger', manufacturer: 'Bell', kind: 'Light helicopter', engines: shaft(1), spanM: 10.2, seats: '5', firstFlight: 1966 },
  B407: { name: '407', manufacturer: 'Bell', kind: 'Light helicopter', engines: shaft(1), spanM: 10.7, lengthM: 12.7, seats: 'up to 7' },
  S76: { name: 'S-76', manufacturer: 'Sikorsky', kind: 'Medium helicopter', engines: shaft(2), spanM: 13.4, lengthM: 16.0, seats: '12', firstFlight: 1977 },
  A139: { name: 'AW139', manufacturer: 'Leonardo', kind: 'Medium helicopter', engines: shaft(2), spanM: 13.8, lengthM: 16.7, seats: 'up to 15', firstFlight: 2001 },

  // ---- Rare visitors: outsize freighters, classics, military (src/discovery spots these) ----
  A124: { name: 'An-124 Ruslan', manufacturer: 'Antonov', kind: 'Outsize cargo aircraft', engines: jet(4), spanM: 73.3, lengthM: 69.1, firstFlight: 1982 },
  BLCF: { name: '747 Dreamlifter', manufacturer: 'Boeing', kind: 'Outsize cargo aircraft', engines: jet(4), spanM: 64.4, lengthM: 71.7, firstFlight: 2006 },
  A337: { name: 'BelugaXL', manufacturer: 'Airbus', kind: 'Outsize cargo aircraft', engines: jet(2), spanM: 60.3, lengthM: 63.1, firstFlight: 2018 },
  A306: { name: 'A300-600', manufacturer: 'Airbus', kind: WIDE, engines: jet(2), spanM: 44.8, lengthM: 54.1, firstFlight: 1983 },
  B742: { name: '747-200', manufacturer: 'Boeing', kind: WIDE, engines: jet(4), spanM: 59.6, lengthM: 70.6, firstFlight: 1970 },
  DC10: { name: 'DC-10', manufacturer: 'McDonnell Douglas', kind: 'Wide-body trijet', engines: jet(3), spanM: 50.4, lengthM: 55.5, firstFlight: 1970 },
  MD11: { name: 'MD-11', manufacturer: 'McDonnell Douglas', kind: 'Wide-body trijet', engines: jet(3), spanM: 52.0, lengthM: 61.6, firstFlight: 1990 },
  IL76: { name: 'Il-76', manufacturer: 'Ilyushin', kind: 'Heavy transport', engines: jet(4), spanM: 50.5, lengthM: 46.6, firstFlight: 1971 },
  C17: { name: 'C-17 Globemaster III', manufacturer: 'Boeing', kind: 'Military transport', engines: jet(4), spanM: 51.8, lengthM: 53.0, firstFlight: 1991 },
  C5M: { name: 'C-5M Super Galaxy', manufacturer: 'Lockheed', kind: 'Military transport', engines: jet(4), spanM: 67.9, lengthM: 75.3 },
  C130: { name: 'C-130 Hercules', manufacturer: 'Lockheed', kind: 'Military transport', engines: prop(4), spanM: 40.4, lengthM: 29.8, firstFlight: 1954 },
  C30J: { name: 'C-130J Super Hercules', manufacturer: 'Lockheed Martin', kind: 'Military transport', engines: prop(4), spanM: 40.4, firstFlight: 1996 },
  K35R: { name: 'KC-135 Stratotanker', manufacturer: 'Boeing', kind: 'Aerial refuelling tanker', engines: jet(4), spanM: 39.9, lengthM: 41.5, firstFlight: 1956 },
  KC46: { name: 'KC-46 Pegasus', manufacturer: 'Boeing', kind: 'Aerial refuelling tanker', engines: jet(2), spanM: 48.1, lengthM: 50.4, firstFlight: 2015 },
  E3TF: { name: 'E-3 Sentry', manufacturer: 'Boeing', kind: 'Airborne early warning aircraft', engines: jet(4), spanM: 44.4, lengthM: 46.6 },
}

/** Facts for a designator, or null. */
export function typeFacts(code: string | null | undefined): TypeFacts | null {
  if (!code) return null
  return TYPES[code.trim().toUpperCase()] ?? null
}

/** "2 × turbofan". */
export function describeEngines(e: TypeFacts['engines']): string {
  return `${e.count} × ${e.type}`
}

/** What to draw and say about an aircraft whose type may or may not be known. */
export type AircraftProfile = {
  shape: ShapeId
  facts: TypeFacts | null
  /** Best available name: from our table, else the database's, else the code. */
  title: string | null
}

export function aircraftProfile(a: { type?: string | null; category?: string | null; dbName?: string | null; dbManufacturer?: string | null }): AircraftProfile {
  // ZZZZ is the ICAO placeholder for "no designator".
  if (a.type?.trim().toUpperCase() === 'ZZZZ') a = { ...a, type: null }
  const facts = typeFacts(a.type)
  // A rotorcraft category wins, as on the map; then the type, then the category.
  const shape: ShapeId = (a.category ?? '').toUpperCase() === 'A7' ? 'ac-heli' : (shapeForType(a.type) ?? shapeForCategory(a.category) ?? 'ac-jet')
  const title = facts ? `${facts.manufacturer} ${facts.name}` : a.dbName ? `${a.dbManufacturer && !a.dbName.startsWith(a.dbManufacturer) ? `${a.dbManufacturer} ` : ''}${a.dbName}` : a.type ? a.type.toUpperCase() : null
  return { shape, facts, title }
}
