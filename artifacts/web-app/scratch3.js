function clusterStrokesByY(strokes) {
  // Compute bounds for each stroke
  const strokeBounds = strokes.map(s => {
    const minY = Math.min(...s.points.map(p => p.y));
    const maxY = Math.max(...s.points.map(p => p.y));
    return { stroke: s, minY, maxY };
  });

  // Sort by minY
  strokeBounds.sort((a, b) => a.minY - b.minY);

  const groups = [];
  let currentGroup = null;
  const GAP_THRESHOLD = 60; // minimum pixels between separate equations (lines are 48px, so a gap of 60px is a full skipped line, or maybe we use 30px to separate distinct lines)

  for (const b of strokeBounds) {
    if (!currentGroup) {
      currentGroup = { strokes: [b.stroke], minY: b.minY, maxY: b.maxY };
      groups.push(currentGroup);
    } else {
      // If the stroke overlaps vertically or is within the gap threshold
      if (b.minY <= currentGroup.maxY + GAP_THRESHOLD) {
        currentGroup.strokes.push(b.stroke);
        currentGroup.maxY = Math.max(currentGroup.maxY, b.maxY);
      } else {
        // Start a new group
        currentGroup = { strokes: [b.stroke], minY: b.minY, maxY: b.maxY };
        groups.push(currentGroup);
      }
    }
  }

  return groups.map(g => g.strokes);
}

// Test data
const strokes = [
  // Line 1
  { id: '1', points: [{y: 100}, {y: 110}] },
  { id: '2', points: [{y: 105}, {y: 115}] },
  // Line 3 (gap of 90)
  { id: '3', points: [{y: 200}, {y: 210}] },
  // Line 3 part 2
  { id: '4', points: [{y: 205}, {y: 220}] },
];

const clusters = clusterStrokesByY(strokes);
console.log(clusters.map(c => c.map(s => s.id)));
