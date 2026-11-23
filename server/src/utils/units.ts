/**
 * Converts recipe quantities into the unit the stock is kept in.
 *
 * Recipe units and stock units are free text, so "250 g" of beef must be
 * turned into 0.25 when the stock is counted in "kg". Without this, recipes
 * written in grams against stock in kilograms deduct 1000x too much.
 */

type Dimension = 'mass' | 'volume' | 'count';

const UNITS: Record<string, { dim: Dimension; factor: number }> = {
  // mass (base: gram)
  mg: { dim: 'mass', factor: 0.001 }, milligram: { dim: 'mass', factor: 0.001 }, milligrams: { dim: 'mass', factor: 0.001 },
  g: { dim: 'mass', factor: 1 }, gm: { dim: 'mass', factor: 1 }, gms: { dim: 'mass', factor: 1 }, gr: { dim: 'mass', factor: 1 },
  gram: { dim: 'mass', factor: 1 }, grams: { dim: 'mass', factor: 1 }, gramme: { dim: 'mass', factor: 1 }, grammes: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 }, kgs: { dim: 'mass', factor: 1000 }, kilo: { dim: 'mass', factor: 1000 }, kilos: { dim: 'mass', factor: 1000 },
  kilogram: { dim: 'mass', factor: 1000 }, kilograms: { dim: 'mass', factor: 1000 },
  // volume (base: millilitre)
  ml: { dim: 'volume', factor: 1 }, millilitre: { dim: 'volume', factor: 1 }, millilitres: { dim: 'volume', factor: 1 },
  milliliter: { dim: 'volume', factor: 1 }, milliliters: { dim: 'volume', factor: 1 },
  cl: { dim: 'volume', factor: 10 }, dl: { dim: 'volume', factor: 100 },
  l: { dim: 'volume', factor: 1000 }, lt: { dim: 'volume', factor: 1000 }, ltr: { dim: 'volume', factor: 1000 }, ltrs: { dim: 'volume', factor: 1000 },
  litre: { dim: 'volume', factor: 1000 }, litres: { dim: 'volume', factor: 1000 }, liter: { dim: 'volume', factor: 1000 }, liters: { dim: 'volume', factor: 1000 },
  // count (base: piece)
  pc: { dim: 'count', factor: 1 }, pcs: { dim: 'count', factor: 1 }, piece: { dim: 'count', factor: 1 }, pieces: { dim: 'count', factor: 1 },
  unit: { dim: 'count', factor: 1 }, units: { dim: 'count', factor: 1 }, each: { dim: 'count', factor: 1 }, ea: { dim: 'count', factor: 1 },
  item: { dim: 'count', factor: 1 }, items: { dim: 'count', factor: 1 }, dozen: { dim: 'count', factor: 12 },
};

const normalize = (unit: string | null | undefined) => String(unit || '').trim().toLowerCase().replace(/\.$/, '');

/**
 * Returns `quantity` (in `fromUnit`) expressed in `toUnit`, or null when the
 * units can't be converted (different dimensions, or unknown and not identical).
 */
export function convertQuantity(quantity: number, fromUnit: string | null | undefined, toUnit: string | null | undefined): number | null {
  const from = normalize(fromUnit);
  const to = normalize(toUnit);
  if (!Number.isFinite(quantity)) return null;
  if (from === to) return quantity;
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  return (quantity * a.factor) / b.factor;
}
