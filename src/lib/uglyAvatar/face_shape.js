function randomFromInterval(min, max) {
  // min and max included
  return Math.random() * (max - min) + min;
}
export function getEggShapePoints(a, b, k, segment_points) {
  // the function is x^2/a^2 * (1 + ky) + y^2/b^2 = 1
  const eggPoint = (i, signX, signY) => {
    var degree =
      (Math.PI / 2 / segment_points) * i +
      randomFromInterval(
        -Math.PI / 1.1 / segment_points,
        Math.PI / 1.1 / segment_points,
      );
    var y = signY * Math.sin(degree) * b;
    var x =
      signX * Math.sqrt(((1 - (y * y) / (b * b)) / (1 + k * y)) * a * a) +
      randomFromInterval(-a / 200.0, a / 200.0);
    return [x, y];
  };
  return [
    ...Array.from({ length: segment_points }, (_, i) => eggPoint(i, 1, 1)),
    ...Array.from({ length: segment_points }, (_, index) => eggPoint(segment_points - index, -1, 1)),
    ...Array.from({ length: segment_points }, (_, i) => eggPoint(i, -1, -1)),
    ...Array.from({ length: segment_points }, (_, index) => eggPoint(segment_points - index, 1, -1)),
  ];
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
    const x = b / m;
    return { x: x, y: b };
  }
}

export function generateRectangularFaceContourPoints(a, b, segment_points) {
  // a is width, b is height, segment_points is the number of points

  const rectPoint = (i, signX, signY) => {
    var degree =
      (Math.PI / 2 / segment_points) * i +
      randomFromInterval(
        -Math.PI / 11 / segment_points,
        Math.PI / 11 / segment_points,
      );
    var intersection = findIntersectionPoints(degree, a, b);
    return [signX * intersection.x, signY * intersection.y];
  };
  return [
    ...Array.from({ length: segment_points }, (_, i) => rectPoint(i, 1, 1)),
    ...Array.from({ length: segment_points }, (_, index) => rectPoint(segment_points - index, -1, 1)),
    ...Array.from({ length: segment_points }, (_, i) => rectPoint(i, -1, -1)),
    ...Array.from({ length: segment_points }, (_, index) => rectPoint(segment_points - index, 1, -1)),
  ];
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
  const translated0 = results0.map(([x, y]) => [x + face0TranslateX, y + face0TranslateY]);
  const translated1 = results1.map(([x, y]) => [x + face1TranslateX, y + face1TranslateY]);
  const blended = translated0.map((point, i) => [
    point[0] * 0.7 +
      translated1[(i + translated0.length / 4) % translated0.length][1] * 0.3,
    point[1] * 0.7 -
      translated1[(i + translated0.length / 4) % translated0.length][0] * 0.3,
  ]);
  const center = blended.reduce(
    (acc, point) => {
      acc[0] += point[0];
      acc[1] += point[1];
      return acc;
    },
    [0, 0]
  );
  center[0] /= blended.length;
  center[1] /= blended.length;
  // center the face
  var results = blended.map(([x, y]) => [x - center[0], y - center[1]]);

  let width = results[0][0] - results[results.length / 2][0];
  let height =
    results[results.length / 4][1] - results[(results.length * 3) / 4][1];
  // add the first point to the end to close the shape
  results.push(results[0]);
  results.push(results[1]);
  return { face: results, width: width, height: height, center: [0, 0] };
}
