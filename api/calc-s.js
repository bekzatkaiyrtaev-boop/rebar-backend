// Расчёт длины отгиба (тип S) — перекрёстная касательная двух равных окружностей
// EN 1992-1-1 §8.1, §8.5

function getDonMin(d) { return d <= 16 ? 4 * d : 7 * d; }
function getRmin(d) { return (getDonMin(d) + d) / 2; }
function arcLen(r, alphaDeg) { return r * alphaDeg * Math.PI / 180; }

function calcS({ A, B, C, D, d, r }) {
  const radius = r || getRmin(d);
  const dy = D - 2 * radius;
  const d_oo = Math.sqrt(B * B + dy * dy);
  const slope = Math.sqrt(Math.max(0, d_oo * d_oo - 4 * radius * radius));
  const alpha = (Math.atan2(dy, B) + Math.asin(Math.min(1, 2 * radius / d_oo))) * 180 / Math.PI;
  const arc = arcLen(radius, Math.abs(alpha));
  const L = A + 2 * arc + slope + C;
  return { L, alpha, slope, arc, radius };
}

const REBAR_MASS = {
  3: 0.055, 4: 0.099, 5: 0.154, 6: 0.222, 7: 0.302, 8: 0.395,
  10: 0.617, 12: 0.888, 14: 1.210, 16: 1.580, 18: 2.000, 20: 2.470,
  22: 2.980, 25: 3.850, 28: 4.830, 32: 6.310, 36: 7.990, 40: 9.870
};
function calcMass(d, Lmm) {
  const q = REBAR_MASS[d] || (Math.PI / 4 * Math.pow(d / 1000, 2) * 7850);
  return q * Lmm / 1000;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { A, B, C, D, d, r } = req.body;
    if ([A, B, C, D, d].some(v => typeof v !== 'number' || isNaN(v))) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }
    const result = calcS({ A, B, C, D, d, r });
    const mass = calcMass(d, result.L);
    res.status(200).json({ ...result, mass });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
