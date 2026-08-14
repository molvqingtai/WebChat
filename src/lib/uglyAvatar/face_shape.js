function randomFromInterval(min, max) {
  // min and max included
  return Math.random() * (max - min) + min;
}
export function getEggShapePoints(a, b, k, segment_points) {
  // the function is x^2/a^2 * (1 + ky) + y^2/b^2 = 1
  //   var pointString = "";
  const positiveUpper = Array.from({ length: segment_points }, (_, i) => {
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 1.1 / segment_points, Math.PI / 1.1 / segment_points)
    const y = Math.sin(degree) * b
    const x = Math.sqrt(((1 - (y * y) / (b * b)) / (1 + k * y)) * a * a) + randomFromInterval(-a / 200.0, a / 200.0)
    return [x, y]
  })
  const negativeUpper = Array.from({ length: segment_points }, (_, index) => {
    const i = segment_points - index
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 1.1 / segment_points, Math.PI / 1.1 / segment_points)
    const y = Math.sin(degree) * b
    const x = -Math.sqrt(((1 - (y * y) / (b * b)) / (1 + k * y)) * a * a) + randomFromInterval(-a / 200.0, a / 200.0)
    return [x, y]
  })
  const negativeLower = Array.from({ length: segment_points }, (_, i) => {
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 1.1 / segment_points, Math.PI / 1.1 / segment_points)
    const y = -Math.sin(degree) * b
    const x = -Math.sqrt(((1 - (y * y) / (b * b)) / (1 + k * y)) * a * a) + randomFromInterval(-a / 200.0, a / 200.0)
    return [x, y]
  })
  const positiveLower = Array.from({ length: segment_points }, (_, index) => {
    const i = segment_points - index
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 1.1 / segment_points, Math.PI / 1.1 / segment_points)
    const y = -Math.sin(degree) * b
    const x = Math.sqrt(((1 - (y * y) / (b * b)) / (1 + k * y)) * a * a) + randomFromInterval(-a / 200.0, a / 200.0)
    return [x, y]
  })
  return [...positiveUpper, ...negativeUpper, ...negativeLower, ...positiveLower]
}

function findIntersectionPoints(radian, a, b) {
  if (radian < 0) {
    radian = 0;
  }
  if (radian > Math.PI / 2) {
    radian = Math.PI / 2;
  }
  // a is width, b is height
  // Slope of the line
  const m = Math.tan(radian);
  // check if radian is close to 90 degrees
  if (Math.abs(radian - Math.PI / 2) < 0.0001) {
    return { x: 0, y: b };
  }
  // only checks the first quadrant
  const y = m * a;
  if (y < b) {
    // it intersects with the left side
    return { x: a, y: y };
  } else {
    // it intersects with the top side
    // console.log(m);
    const x = b / m;
    // console.log(x, b);
    return { x: x, y: b };
  }
}

export function generateRectangularFaceContourPoints(a, b, segment_points) {
  // a is width, b is height, segment_points is the number of points

  const q1 = Array.from({ length: segment_points }, (_, i) => {
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 11 / segment_points, Math.PI / 11 / segment_points)
    const intersection = findIntersectionPoints(degree, a, b)
    return [intersection.x, intersection.y]
  })
  const q2 = Array.from({ length: segment_points }, (_, index) => {
    const i = segment_points - index
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 11 / segment_points, Math.PI / 11 / segment_points)
    const intersection = findIntersectionPoints(degree, a, b)
    return [-intersection.x, intersection.y]
  })
  const q3 = Array.from({ length: segment_points }, (_, i) => {
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 11 / segment_points, Math.PI / 11 / segment_points)
    const intersection = findIntersectionPoints(degree, a, b)
    return [-intersection.x, -intersection.y]
  })
  const q4 = Array.from({ length: segment_points }, (_, index) => {
    const i = segment_points - index
    const degree = (Math.PI / 2 / segment_points) * i + randomFromInterval(-Math.PI / 11 / segment_points, Math.PI / 11 / segment_points)
    const intersection = findIntersectionPoints(degree, a, b)
    return [intersection.x, -intersection.y]
  })
  return [...q1, ...q2, ...q3, ...q4]
}

export function generateFaceCountourPoints(numPoints = 100) {
  var faceSizeX0 = randomFromInterval(50, 100);
  var faceSizeY0 = randomFromInterval(70, 100);

  var faceSizeY1 = randomFromInterval(50, 80);
  var faceSizeX1 = randomFromInterval(70, 100);
  var faceK0 =
    randomFromInterval(0.001, 0.005) * (Math.random() > 0.5 ? 1 : -1);
  var faceK1 =
    randomFromInterval(0.001, 0.005) * (Math.random() > 0.5 ? 1 : -1);
  var face0TranslateX = randomFromInterval(-5, 5);
  var face0TranslateY = randomFromInterval(-15, 15);

  var face1TranslateY = randomFromInterval(-5, 5);
  var face1TranslateX = randomFromInterval(-5, 25);
  var eggOrRect0 = Math.random() > 0.1;
  var eggOrRect1 = Math.random() > 0.3;

  var results0 = eggOrRect0
    ? getEggShapePoints(faceSizeX0, faceSizeY0, faceK0, numPoints)
    : generateRectangularFaceContourPoints(faceSizeX0, faceSizeY0, numPoints);
  var results1 = eggOrRect1
    ? getEggShapePoints(faceSizeX1, faceSizeY1, faceK1, numPoints)
    : generateRectangularFaceContourPoints(faceSizeX1, faceSizeY1, numPoints);
  const shifted0 = results0.map(([x, y]) => [x + face0TranslateX, y + face0TranslateY])
  const shifted1 = results1.map(([x, y]) => [x + face1TranslateX, y + face1TranslateY])
  const results = shifted0.map(([x0, y0], i) => [
    x0 * 0.7 + shifted1[(i + shifted0.length / 4) % shifted0.length][1] * 0.3,
    y0 * 0.7 - shifted1[(i + shifted0.length / 4) % shifted0.length][0] * 0.3,
  ])
  const center = [
    results.reduce((sum, [x]) => sum + x, 0) / results.length,
    results.reduce((sum, [, y]) => sum + y, 0) / results.length,
  ]
  // center the face
  const centered = results.map(([x, y]) => [x - center[0], y - center[1]])

  let width = centered[0][0] - centered[centered.length / 2][0];
  let height =
    centered[centered.length / 4][1] - centered[(centered.length * 3) / 4][1];
  // add the first point to the end to close the shape
  centered.push(centered[0]);
  centered.push(centered[1]);
  // console.log(results);
  return { face: centered, width: width, height: height, center: [0, 0] };
}
