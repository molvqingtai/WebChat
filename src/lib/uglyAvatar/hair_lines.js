function randomFromInterval(min, max) {
  // min and max included
  return Math.random() * (max - min) + min;
}
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

function binomialCoefficient(n, k) {
  return factorial(n) / (factorial(k) * factorial(n - k));
}

function calculateBezierPoint(t, controlPoints) {
  let x = 0, y = 0;
  const n = controlPoints.length - 1;

  const terms = Array.from({ length: n + 1 }, (_, i) => binomialCoefficient(n, i) * Math.pow(1 - t, n - i) * Math.pow(t, i));
  x = terms.reduce((sum, coeff, i) => sum + coeff * controlPoints[i].x, 0);
  y = terms.reduce((sum, coeff, i) => sum + coeff * controlPoints[i].y, 0);

  return [x, y];
}

function computeBezierCurve(controlPoints, numberOfPoints) {
  return Array.from({ length: numberOfPoints + 1 }, (_, i) => calculateBezierPoint(i / numberOfPoints, controlPoints));
}

export function generateHairLines0(faceCountour, numHairLines = 100) {
  const faceCountourCopy = faceCountour.slice(0, faceCountour.length - 2);
  return Array.from({ length: numHairLines }, () => {
    const numHairPoints = 20 + Math.floor(randomFromInterval(-5, 5));
    // we generate some hair lines
    const offset0 = Math.floor(randomFromInterval(30, 140));
    const hairLine0 = Array.from({ length: numHairPoints }, (_, j) => {
      const point = faceCountourCopy[(faceCountourCopy.length - (j + offset0)) % faceCountourCopy.length];
      return { x: point[0], y: point[1] };
    });
    const d0 = computeBezierCurve(hairLine0, numHairPoints);
    const offset1 = Math.floor(randomFromInterval(30, 140));
    const hairLine1 = Array.from({ length: numHairPoints }, (_, j) => {
      const point = faceCountourCopy[(faceCountourCopy.length - (-j + offset1)) % faceCountourCopy.length];
      return { x: point[0], y: point[1] };
    });
    const d1 = computeBezierCurve(hairLine1, numHairPoints);
    return Array.from({ length: numHairPoints }, (_, j) => {
      const blend = (j * (1 / numHairPoints)) ** 2;
      return [d0[j][0] * blend + d1[j][0] * (1 - blend), d0[j][1] * blend + d1[j][1] * (1 - blend)];
    });
  });
}
export function generateHairLines1(faceCountour, numHairLines = 100) {
  const faceCountourCopy = faceCountour.slice(0, faceCountour.length - 2);
  return Array.from({ length: numHairLines }, () => {
    const numHairPoints = 20 + Math.floor(randomFromInterval(-5, 5));
    // we generate some hair lines
    const seedStart = Math.floor(randomFromInterval(20, 160))
    const seed = faceCountourCopy[(faceCountourCopy.length - seedStart) % faceCountourCopy.length]
    const hairPoints = [
      { x: seed[0], y: seed[1] },
      ...Array.from({ length: numHairPoints }, () => {
        const indexStart = Math.floor(randomFromInterval(20, 160))
        const point = faceCountourCopy[(faceCountourCopy.length - indexStart) % faceCountourCopy.length]
        return { x: point[0], y: point[1] }
      })
    ]
    return computeBezierCurve(hairPoints, numHairPoints)
  });
}


export function generateHairLines2(faceCountour, numHairLines = 100) {
  
  const faceCountourCopy = faceCountour.slice(0, faceCountour.length - 2);
  const results = [];
  const pickedIndices = Array.from({ length: numHairLines }, () => Math.floor(randomFromInterval(10, 180))).toSorted();
  // functional-loop: continue — the first line seeds the results without the distance merge
  for (var i = 0; i < numHairLines; i++){
    var numHairPoints = 20 + Math.floor(randomFromInterval(-5, 5));
    // we generate some hair lines
    var index_offset = pickedIndices[i];
    var lower = randomFromInterval(0.8 , 1.4);
    var reverse = Math.random() > 0.5 ? 1 : -1;
    var hair_line = Array.from({ length: numHairPoints }, (_, j) => {
      var powerscale = randomFromInterval(0.1, 3);
      var portion = (1 - (j / numHairPoints) ** powerscale) * (1 - lower) + lower;
      var point = faceCountourCopy[(faceCountourCopy.length - (reverse * j + index_offset)) % faceCountourCopy.length];
      return { x: point[0] * portion, y: point[1] * portion };
    });
    var d = computeBezierCurve(hair_line, numHairPoints);
    if (Math.random() > 0.7) d = d.toReversed();
    if (results.length == 0){
      results.push(d);
      continue;
    }
    var lastHairPoint = results[results.length - 1][results[results.length - 1].length - 1];
    var lastPointsDistance = Math.sqrt((d[0][0] - lastHairPoint[0]) ** 2 + (d[0][1] - lastHairPoint[1]) ** 2);
    if (Math.random() > 0.5 && lastPointsDistance < 100){
      results[results.length - 1] = results[results.length - 1].concat(d);
    }else{
      results.push(d);
    }
  }
  return results;
}

export function generateHairLines3(faceCountour, numHairLines = 100) {
  const faceCountourCopy = faceCountour.slice(0, faceCountour.length - 2);
  const pickedIndices = Array.from({ length: numHairLines }, () => Math.floor(randomFromInterval(10, 180))).toSorted();
  const splitPoint = Math.floor(randomFromInterval(0, 200));
  return Array.from({ length: numHairLines }, (_, i) => {
    const numHairPoints = 30 + Math.floor(randomFromInterval(-8, 8));
    // we generate some hair lines
    const indexOffset = pickedIndices[i];
    let lower = randomFromInterval(1 , 2.3);
    if (Math.random() > 0.9) lower = randomFromInterval(0 , 1.);
    const reverse = indexOffset > splitPoint ? 1 : -1;
    const hairLine = Array.from({ length: numHairPoints }, (_, j) => {
      const powerscale = randomFromInterval(0.1, 3);
      const portion = (1 - (j / (numHairPoints)) ** powerscale) * (1 - lower) + lower;
      const point = faceCountourCopy[(faceCountourCopy.length - (reverse * j * 2 + indexOffset)) % faceCountourCopy.length];
      return { x: point[0] * portion, y: point[1] };
    });
    return computeBezierCurve(hairLine, numHairPoints);
  });
}