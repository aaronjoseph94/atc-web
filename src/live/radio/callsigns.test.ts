import { describe, expect, it } from 'vitest'
import { findCallsigns, guessSpeaker, readNumber, splitCalls, tokenize, writtenCallsign } from './callsigns'

const signs = (text: string) => findCallsigns(text).map((m) => m.callsign)
const num = (text: string) => {
  const r = readNumber(tokenize(text), 0)
  return r ? `${r.digits}${r.letters}` : null
}

describe('readNumber', () => {
  it('reads the ways flight numbers are spoken', () => {
    expect(num('two eighty eight')).toBe('288')
    expect(num('two eighty-eight')).toBe('288')
    expect(num('twenty two ninety two')).toBe('2292')
    expect(num('twenty-two ninety-two')).toBe('2292')
    expect(num('fourteen oh seven')).toBe('1407')
    expect(num('fifty one fifty five')).toBe('5155')
    expect(num('one four kilo')).toBe('14K')
    expect(num('one two three')).toBe('123')
    expect(num('niner zero four')).toBe('904')
    expect(num('twelve hundred')).toBe('1200')
    expect(num('twelve hundred five')).toBe('1205')
    expect(num('three hundred')).toBe('300')
    expect(num('seventy')).toBe('70')
    expect(num('1-8-1-8')).toBe('1818')
    expect(num('5155')).toBe('5155')
    expect(num('14k')).toBe('14K')
  })

  it('stops at punctuation and at words that are not numbers', () => {
    expect(num('two eighty eight, runway four')).toBe('288')
    expect(num('678 heavy')).toBe('678')
    expect(num('tower')).toBeNull()
  })
})

describe('findCallsigns', () => {
  it('reads airline calls in digits and in words', () => {
    expect(signs('Delta two eighty-eight, runway 4 left, cleared to land')).toEqual(['DAL288'])
    expect(signs('American twenty-two ninety-two, contact departure')).toEqual(['AAL2292'])
    expect(signs('Speedbird one four kilo, taxi via Alpha')).toEqual(['BAW14K'])
    expect(signs('JetBlue fourteen oh seven, hold short runway 31 left')).toEqual(['JBU1407'])
    expect(signs('Jet Blue 1407 heavy')).toEqual(['JBU1407'])
    expect(signs('Endeavor 5155, monitor tower')).toEqual(['EDV5155'])
    expect(signs('Endeavour fifty one fifty five')).toEqual(['EDV5155'])
    expect(signs('Brickyard 4512, Kennedy Ground')).toEqual(['RPA4512'])
    expect(signs('Cactus 1549, turn left heading 270')).toEqual(['AWE1549'])
    expect(signs('Jazz 408 heavy')).toEqual(['JZA408'])
    expect(signs('Air Canada eight seventy one, wind 290 at 12')).toEqual(['ACA871'])
    expect(signs('Southwest 2416 roger')).toEqual(['SWA2416'])
    expect(signs('FedEx 1407 super, runway 4R')).toEqual(['FDX1407'])
    expect(signs('UPS 2905, Ground')).toEqual(['UPS2905'])
  })

  it('handles the reference calls', () => {
    const klm = findCallsigns('KLM 678 heavy, Tower, line up and wait runway 17R. Traffic landing runway 29.')
    expect(klm.map((m) => m.callsign)).toEqual(['KLM678'])
    expect(klm[0].heavy).toBe(true)
    expect(signs('Flair 809, Clearance')).toEqual(['FLE809'])
    expect(signs('Ground, hello, WestJet 1501 exiting D3 for 83')).toEqual(['WJA1501'])
    expect(signs('Uh, Flair 809, gate 16N, uh,')).toEqual(['FLE809'])
  })

  it('reads US registrations', () => {
    expect(signs('November one eight one eight Charlie, Tower, cleared for takeoff')).toEqual(['N1818C'])
    expect(signs('November 1818 Charlie')).toEqual(['N1818C'])
    expect(signs('N1818C, wind calm')).toEqual(['N1818C'])
    expect(signs('November 123AB')).toEqual(['N123AB'])
    expect(signs('Cessna eight Charlie, runway 31, cleared to land')).toEqual(['8C'])
    expect(findCallsigns('Cessna eight Charlie')[0].kind).toBe('partial-tail')
    expect(signs('Citation one two three alpha bravo')).toEqual(['123AB'])
  })

  it('reads Canadian registrations', () => {
    expect(signs('Golf Echo November Whiskey, Calgary Ground')).toEqual(['CGENW'])
    expect(signs('Charlie Golf Echo November Whiskey')).toEqual(['CGENW'])
    expect(signs('C-GENW taxi via Charlie')).toEqual(['CGENW'])
    expect(signs('Ground, CGENW request taxi')).toEqual(['CGENW'])
  })

  it('finds every callsign in a call, in order', () => {
    expect(signs('Delta 288, follow the American, American 1234 on the left')).toEqual(['DAL288', 'AAL1234'])
    expect(signs('JetBlue 22, number two, traffic to follow Southwest 1871 on a two mile final')).toEqual(['JBU22', 'SWA1871'])
  })

  it('does not mistake taxiways, runways and frequencies for callsigns', () => {
    expect(signs('Taxi via Alpha, Bravo, hold short runway 22 left')).toEqual([])
    expect(signs('contact departure one two four point seven five')).toEqual([])
    expect(signs('wind three one zero at one two, altimeter two niner niner two')).toEqual([])
    const taxi = findCallsigns('turn right on Delta 3, hold short of Kilo')
    expect(taxi.every((m) => m.doubt >= 0.5)).toBe(true)
  })

  it('keeps character offsets so the call can be highlighted', () => {
    const text = 'Ground, hello, WestJet 1501 exiting D3'
    const [m] = findCallsigns(text)
    expect(text.slice(m.from, m.to)).toBe('WestJet 1501')
  })
})

describe('guessSpeaker', () => {
  it('tells controllers from pilots', () => {
    expect(guessSpeaker('KLM 678 heavy, Tower, line up and wait runway 17R')).toBe('controller')
    expect(guessSpeaker('Flair 809, Clearance')).toBe('controller')
    expect(guessSpeaker('Ground, hello, WestJet 1501 exiting D3 for 83')).toBe('pilot')
    expect(guessSpeaker('Uh, Flair 809, gate 16N, uh,')).toBe('pilot')
    expect(guessSpeaker('Delta 288, runway 4 left, cleared to land, wind 310 at 12')).toBe('controller')
    expect(guessSpeaker('Cleared to land runway 4 left, Delta 288')).toBe('pilot')
    expect(guessSpeaker('Kennedy Tower, JetBlue 1407 with you on the RNAV 4 right')).toBe('pilot')
    expect(guessSpeaker('Line up and wait 31 left, American 2292')).toBe('pilot')
    expect(guessSpeaker('American 2292, runway 31 left, line up and wait')).toBe('controller')
    expect(guessSpeaker('Calgary Ground, Golf Echo November Whiskey, request taxi with information Bravo')).toBe('pilot')
    expect(guessSpeaker('Endeavor 5155, contact ground point niner')).toBe('controller')
  })

  it('uses phraseology when there is no callsign', () => {
    expect(guessSpeaker('Wind two seven zero at one five, runway two seven, cleared to land')).toBe('controller')
    expect(guessSpeaker('Roger, we are ready')).toBe('pilot')
    expect(guessSpeaker('')).toBeNull()
  })
})

describe('writtenCallsign', () => {
  it('spells callsigns the way a transcript would', () => {
    expect(writtenCallsign('DAL288')).toBe('Delta 288')
    expect(writtenCallsign('RPA4512')).toBe('Brickyard 4512')
    expect(writtenCallsign('BAW14K')).toBe('Speedbird 14K')
    expect(writtenCallsign('N1818C')).toBe('N1818C')
    expect(writtenCallsign('XYZ12')).toBeNull()
  })
})

describe('splitCalls', () => {
  const seg = (start: number, end: number, text: string) => ({ start, end, text })
  it('separates back-to-back calls in one upload', () => {
    const calls = splitCalls([
      seg(0, 4.6, 'Delta 714, right on Quebec, cross runway 25 right,'),
      seg(4.6, 6.1, 'then contact ground point 75.'),
      seg(6.3, 9, 'Right on Quebec, cross 25 right, ground point 75, Delta 714.'),
      seg(9.2, 11, 'Tower, United 434 with you.'),
    ])
    expect(calls.map((c) => c.text)).toEqual([
      'Delta 714, right on Quebec, cross runway 25 right, then contact ground point 75.',
      'Right on Quebec, cross 25 right, ground point 75, Delta 714.',
      'Tower, United 434 with you.',
    ])
    expect(calls[0]).toMatchObject({ start: 0, end: 6.1 })
  })
  it('keeps a single call whole', () => {
    expect(splitCalls([seg(0, 2, 'KLM 678 heavy, Tower,'), seg(2, 5, 'line up and wait runway 17R.')])).toHaveLength(1)
    expect(splitCalls([])).toEqual([])
  })
})
