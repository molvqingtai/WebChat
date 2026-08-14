function randomFromInterval(min, max) {
    // min and max included
    return Math.random() * (max - min) + min;
}
function cubicBezier(P0, P1, P2, P3, t) {
    var x = (1 - t) ** 3 * P0[0] + 3 * (1 - t) ** 2 * t * P1[0] + 3 * (1 - t) * t ** 2 * P2[0] + t ** 3 * P3[0];
    var y = (1 - t) ** 3 * P0[1] + 3 * (1 - t) ** 2 * t * P1[1] + 3 * (1 - t) * t ** 2 * P2[1] + t ** 3 * P3[1];
    return [x, y];
}
function getEggShapePoints(a, b, k, segment_points) {
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

export function generateMouthShape0(faceCountour, faceHeight, faceWidth) {
    // the first one is a a big smile U shape
    // choose one point on face at bottom side
    var mouthRightY = randomFromInterval(faceHeight / 7, faceHeight / 3.5)
    var mouthLeftY = randomFromInterval(faceHeight / 7, faceHeight / 3.5)
    var mouthRightX = randomFromInterval(faceWidth / 10, faceWidth / 2)
    var mouthLeftX = -mouthRightX + randomFromInterval(-faceWidth / 20, faceWidth / 20)
    var mouthRight = [mouthRightX, mouthRightY]
    var mouthLeft = [mouthLeftX, mouthLeftY]

    var controlPoint0 = [randomFromInterval(0, mouthRightX), randomFromInterval(mouthLeftY + 5, faceHeight / 1.5)]
    var controlPoint1 = [randomFromInterval(mouthLeftX, 0), randomFromInterval(mouthLeftY + 5, faceHeight / 1.5)]

    var mouthPoints = []
    mouthPoints.push(...Array.from({ length: 100 }, (_, i) => cubicBezier(mouthLeft, controlPoint1, controlPoint0, mouthRight, i * 0.01)))
    if (Math.random() > 0.5) {
        mouthPoints.push(...Array.from({ length: 100 }, (_, i) => cubicBezier(mouthRight, controlPoint0, controlPoint1, mouthLeft, i * 0.01)))
    }else{
        var y_offset_portion = randomFromInterval(0, 0.8);
        mouthPoints.push(...Array.from({ length: 100 }, (_, i) => {
            const blend = i / 100.0
            return [mouthPoints[99][0] * (1 - blend) + mouthPoints[0][0] * blend, (mouthPoints[99][1] * (1 - blend) + mouthPoints[0][1] * blend) * (1 - y_offset_portion) + mouthPoints[99 - i][1] * y_offset_portion]
        }))
    }
    return mouthPoints;
}

export function generateMouthShape1(faceCountour, faceHeight, faceWidth) {
    // the first one is a a big smile U shape
    // choose one point on face at bottom side
    var mouthRightY = randomFromInterval(faceHeight / 7, faceHeight / 4)
    var mouthLeftY = randomFromInterval(faceHeight / 7, faceHeight / 4)
    var mouthRightX = randomFromInterval(faceWidth / 10, faceWidth / 2)
    var mouthLeftX = -mouthRightX + randomFromInterval(-faceWidth / 20, faceWidth / 20)
    var mouthRight = [mouthRightX, mouthRightY]
    var mouthLeft = [mouthLeftX, mouthLeftY]

    var controlPoint0 = [randomFromInterval(0, mouthRightX), randomFromInterval(mouthLeftY + 5, faceHeight / 1.5)]
    var controlPoint1 = [randomFromInterval(mouthLeftX, 0), randomFromInterval(mouthLeftY + 5, faceHeight / 1.5)]

    var mouthPoints = []
    mouthPoints.push(...Array.from({ length: 100 }, (_, i) => cubicBezier(mouthLeft, controlPoint1, controlPoint0, mouthRight, i * 0.01)))

    var center = [(mouthRight[0] + mouthLeft[0]) / 2, mouthPoints[25][1] / 2 + mouthPoints[75][1] / 2];
    if (Math.random() > 0.5) {
        mouthPoints.push(...Array.from({ length: 100 }, (_, i) => cubicBezier(mouthRight, controlPoint0, controlPoint1, mouthLeft, i * 0.01)))
    }else{
        var y_offset_portion = randomFromInterval(0, 0.8);
        mouthPoints.push(...Array.from({ length: 100 }, (_, i) => {
            const blend = i / 100.0
            return [mouthPoints[99][0] * (1 - blend) + mouthPoints[0][0] * blend, (mouthPoints[99][1] * (1 - blend) + mouthPoints[0][1] * blend) * (1 - y_offset_portion) + mouthPoints[99 - i][1] * y_offset_portion]
        }))
    }
    // translate to center
    return mouthPoints.map(([x, y]) => {
        const shiftedX = x - center[0]
        const shiftedY = y - center[1]
        // rotate 180 degree, scale smaller, and translate back
        return [shiftedX * 0.6 + center[0], -shiftedY * 0.6 + center[1] * 0.8]
    });
}

export function generateMouthShape2(faceCountour, faceHeight, faceWidth) {
    // generate a random center
    var center = [randomFromInterval(-faceWidth / 8, faceWidth / 8), randomFromInterval(faceHeight / 4, faceHeight / 2.5)]

    var mouthPoints = getEggShapePoints(randomFromInterval(faceWidth / 4, faceWidth / 10), randomFromInterval(faceHeight / 10, faceHeight / 20), 0.001, 50);
    var randomRotationDegree = randomFromInterval(-Math.PI / 9.5, Math.PI / 9.5)
    return mouthPoints.map(([x, y]) => {
        // rotate the point and translate to center
        const rotatedX = x * Math.cos(randomRotationDegree) - y * Math.sin(randomRotationDegree)
        const rotatedY = x * Math.sin(randomRotationDegree) + y * Math.cos(randomRotationDegree)
        return [rotatedX + center[0], rotatedY + center[1]]
    });
}