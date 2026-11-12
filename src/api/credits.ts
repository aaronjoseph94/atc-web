/**
 * Who to credit for the map and the live traffic, with the links their
 * licences ask for. Shown under "Map data and credits" in Help (the menu has
 * an entry that opens it, and carries the short OpenStreetMap credit).
 *
 * The map itself shows no attribution control, so these lists are the
 * app's attribution: keep them complete. OpenStreetMap's data is ODbL
 * ("© OpenStreetMap contributors" with a link to the copyright page);
 * the tiles are built with the OpenMapTiles schema (CC-BY) and served by
 * OpenFreeMap. adsb.fi asks for a citation with a link; adsb.lol's data is
 * ODbL, which requires attribution; OpenSky asks to be credited too. See
 * docs/data-sources.md for every source and its terms.
 */
export type Credit = { name: string; href: string }

/** The base map: data, tile schema and tile host. */
export const MAP_CREDITS: Credit[] = [
  { name: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' },
  { name: 'OpenMapTiles', href: 'https://openmaptiles.org/' },
  { name: 'OpenFreeMap', href: 'https://openfreemap.org/' },
]

/** The live-traffic feeds. */
export const TRAFFIC_CREDITS: Credit[] = [
  { name: 'adsb.fi', href: 'https://adsb.fi' },
  { name: 'adsb.lol (ODbL)', href: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  { name: 'adsb.one', href: 'https://adsb.one' },
  { name: 'The OpenSky Network', href: 'https://opensky-network.org' },
]

/** The short credit the menu carries. */
export const OSM_CREDIT: Credit = { name: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' }
