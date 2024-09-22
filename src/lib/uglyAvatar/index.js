/**
 * Ported from the ugly-avatar project
 * Repo：https://github.com/txstc55/ugly-avatar
 */
import { generateFaceCountourPoints } from './face_shape.js'
import { generateBothEyes } from './eye_shape.js'
import { generateHairLines0, generateHairLines1, generateHairLines2, generateHairLines3 } from './hair_lines.js'
import { generateMouthShape0, generateMouthShape1, generateMouthShape2 } from './mouth_shape.js'

// createElement function
const createElement = (template) => {
  return new Range().createContextualFragment(template).firstElementChild
}

function randomFromInterval(min, max) {
  return Math.random() * (max - min) + min
}

function createAvatarSvg() {
  const data = {
    faceScale: 1.8, // face scale
    computedFacePoints: [], // the polygon points for face countour
    eyeRightUpper: [], // the points for right eye upper lid
    eyeRightLower: [],
    eyeRightCountour: [], // for the white part of the eye
    eyeLeftUpper: [],
    eyeLeftLower: [],
    eyeLeftCountour: [],
    faceHeight: 0, // the height of the face
    faceWidth: 0, // the width of the face
    center: [0, 0], // the center of the face
    distanceBetweenEyes: 0, // the distance between the eyes
    leftEyeOffsetX: 0, // the offset of the left eye
    leftEyeOffsetY: 0, // the offset of the left eye
    rightEyeOffsetX: 0, // the offset of the right eye
    rightEyeOffsetY: 0, // the offset of the right eye
    eyeHeightOffset: 0, // the offset of the eye height
    leftEyeCenter: [0, 0], // the center of the left eye
    rightEyeCenter: [0, 0], // the center of the right eye
    rightPupilShiftX: 0, // the shift of the right pupil
    rightPupilShiftY: 0, // the shift of the right pupil
    leftPupilShiftX: 0, // the shift of the left pupil
    leftPupilShiftY: 0, // the shift of the left pupil
    rightNoseCenterX: 0, // the center of the right nose
    rightNoseCenterY: 0, // the center of the right nose
    leftNoseCenterX: 0, // the center of the left nose
    leftNoseCenterY: 0, // the center of the left nose
    hairs: [],
    haventSleptForDays: false,
    hairColors: [
      'rgb(0, 0, 0)', // Black
      'rgb(44, 34, 43)', // Dark Brown
      'rgb(80, 68, 68)', // Medium Brown
      'rgb(167, 133, 106)', // Light Brown
      'rgb(220, 208, 186)', // Blond
      'rgb(233, 236, 239)', // Platinum Blond
      'rgb(165, 42, 42)', // Red
      'rgb(145, 85, 61)', // Auburn
      'rgb(128, 128, 128)', // Grey
      'rgb(185, 55, 55)', // Fire
      'rgb(255, 192, 203)', // Pastel Pink
      'rgb(255, 105, 180)', // Bright Pink
      'rgb(230, 230, 250)', // Lavender
      'rgb(64, 224, 208)', // Turquoise
      'rgb(0, 191, 255)', // Bright Blue
      'rgb(148, 0, 211)', // Deep Purple
      'rgb(50, 205, 50)', // Lime Green
      'rgb(255, 165, 0)', // Vivid Orange
      'rgb(220, 20, 60)', // Crimson Red
      'rgb(192, 192, 192)', // Silver
      'rgb(255, 215, 0)', // Gold
      'rgb(255, 255, 255)', // White
      'rgb(124, 252, 0)', // Lawn Green
      'rgb(127, 255, 0)', // Chartreuse
      'rgb(0, 255, 127)', // Spring Green
      'rgb(72, 209, 204)', // Medium Turquoise
      'rgb(0, 255, 255)', // Cyan
      'rgb(0, 206, 209)', // Dark Turquoise
      'rgb(32, 178, 170)', // Light Sea Green
      'rgb(95, 158, 160)', // Cadet Blue
      'rgb(70, 130, 180)', // Steel Blue
      'rgb(176, 196, 222)', // Light Steel Blue
      'rgb(30, 144, 255)', // Dodger Blue
      'rgb(135, 206, 235)', // Sky Blue
      'rgb(0, 0, 139)', // Dark Blue
      'rgb(138, 43, 226)', // Blue Violet
      'rgb(75, 0, 130)', // Indigo
      'rgb(139, 0, 139)', // Dark Magenta
      'rgb(153, 50, 204)', // Dark Orchid
      'rgb(186, 85, 211)', // Medium Orchid
      'rgb(218, 112, 214)', // Orchid
      'rgb(221, 160, 221)', // Plum
      'rgb(238, 130, 238)', // Violet
      'rgb(255, 0, 255)', // Magenta
      'rgb(216, 191, 216)', // Thistle
      'rgb(255, 20, 147)', // Deep Pink
      'rgb(255, 69, 0)', // Orange Red
      'rgb(255, 140, 0)', // Dark Orange
      'rgb(255, 165, 0)', // Orange
      'rgb(250, 128, 114)', // Salmon
      'rgb(233, 150, 122)', // Dark Salmon
      'rgb(240, 128, 128)', // Light Coral
      'rgb(205, 92, 92)', // Indian Red
      'rgb(255, 99, 71)', // Tomato
      'rgb(255, 160, 122)', // Light Salmon
      'rgb(220, 20, 60)', // Crimson
      'rgb(139, 0, 0)', // Dark Red
      'rgb(178, 34, 34)', // Fire Brick
      'rgb(250, 235, 215)', // Antique White
      'rgb(255, 239, 213)', // Papaya Whip
      'rgb(255, 235, 205)', // Blanched Almond
      'rgb(255, 222, 173)', // Navajo White
      'rgb(245, 245, 220)', // Beige
      'rgb(255, 228, 196)', // Bisque
      'rgb(255, 218, 185)', // Peach Puff
      'rgb(244, 164, 96)', // Sandy Brown
      'rgb(210, 180, 140)', // Tan
      'rgb(222, 184, 135)', // Burly Wood
      'rgb(250, 250, 210)', // Light Goldenrod Yellow
      'rgb(255, 250, 205)', // Lemon Chiffon
      'rgb(255, 245, 238)', // Sea Shell
      'rgb(253, 245, 230)', // Old Lace
      'rgb(255, 228, 225)', // Misty Rose
      'rgb(255, 240, 245)', // Lavender Blush
      'rgb(250, 240, 230)', // Linen
      'rgb(255, 228, 181)', // Moccasin
      'rgb(255, 250, 250)', // Snow
      'rgb(240, 255, 255)', // Azure
      'rgb(240, 255, 240)', // Honeydew
      'rgb(245, 245, 245)', // White Smoke
      'rgb(245, 255, 250)', // Mint Cream
      'rgb(240, 248, 255)', // Alice Blue
      'rgb(240, 248, 255)', // Ghost White
      'rgb(248, 248, 255)', // Ghost White
      'rgb(255, 250, 240)', // Floral White
      'rgb(253, 245, 230)' // Old Lace
    ],
    hairColor: 'black',
    dyeColorOffset: '50%',
    backgroundColors: [
      'rgb(245, 245, 220)', // Soft Beige
      'rgb(176, 224, 230)', // Pale Blue
      'rgb(211, 211, 211)', // Light Grey
      'rgb(152, 251, 152)', // Pastel Green
      'rgb(255, 253, 208)', // Cream
      'rgb(230, 230, 250)', // Muted Lavender
      'rgb(188, 143, 143)', // Dusty Rose
      'rgb(135, 206, 235)', // Sky Blue
      'rgb(245, 255, 250)', // Mint Cream
      'rgb(245, 222, 179)', // Wheat
      'rgb(47, 79, 79)', // Dark Slate Gray
      'rgb(72, 61, 139)', // Dark Slate Blue
      'rgb(60, 20, 20)', // Dark Brown
      'rgb(25, 25, 112)', // Midnight Blue
      'rgb(139, 0, 0)', // Dark Red
      'rgb(85, 107, 47)', // Olive Drab
      'rgb(128, 0, 128)', // Purple
      'rgb(0, 100, 0)', // Dark Green
      'rgb(0, 0, 139)', // Dark Blue
      'rgb(105, 105, 105)', // Dim Gray
      'rgb(240, 128, 128)', // Light Coral
      'rgb(255, 160, 122)', // Light Salmon
      'rgb(255, 218, 185)', // Peach Puff
      'rgb(255, 228, 196)', // Bisque
      'rgb(255, 222, 173)', // Navajo White
      'rgb(255, 250, 205)', // Lemon Chiffon
      'rgb(250, 250, 210)', // Light Goldenrod Yellow
      'rgb(255, 239, 213)', // Papaya Whip
      'rgb(255, 245, 238)', // Sea Shell
      'rgb(255, 248, 220)', // Cornsilk
      'rgb(255, 255, 240)', // Ivory
      'rgb(240, 255, 240)', // Honeydew
      'rgb(240, 255, 255)', // Azure
      'rgb(240, 248, 255)', // Alice Blue
      'rgb(248, 248, 255)', // Ghost White
      'rgb(255, 250, 250)', // Snow
      'rgb(255, 240, 245)', // Lavender Blush
      'rgb(255, 228, 225)', // Misty Rose
      'rgb(230, 230, 250)', // Lavender
      'rgb(216, 191, 216)', // Thistle
      'rgb(221, 160, 221)', // Plum
      'rgb(238, 130, 238)', // Violet
      'rgb(218, 112, 214)', // Orchid
      'rgb(186, 85, 211)', // Medium Orchid
      'rgb(147, 112, 219)', // Medium Purple
      'rgb(138, 43, 226)', // Blue Violet
      'rgb(148, 0, 211)', // Dark Violet
      'rgb(153, 50, 204)', // Dark Orchid
      'rgb(139, 69, 19)', // Saddle Brown
      'rgb(160, 82, 45)', // Sienna
      'rgb(210, 105, 30)', // Chocolate
      'rgb(205, 133, 63)', // Peru
      'rgb(244, 164, 96)', // Sandy Brown
      'rgb(222, 184, 135)', // Burly Wood
      'rgb(255, 250, 240)', // Floral White
      'rgb(253, 245, 230)', // Old Lace
      'rgb(250, 240, 230)' // Linen
    ],
    mouthPoints: []
  }

  data.faceScale = 1.5 + Math.random() * 0.6
  data.haventSleptForDays = Math.random() > 0.8
  let faceResults = generateFaceCountourPoints()
  data.computedFacePoints = faceResults.face
  data.faceHeight = faceResults.height
  data.faceWidth = faceResults.width
  data.center = faceResults.center
  let eyes = generateBothEyes(data.faceWidth / 2)
  let left = eyes.left
  let right = eyes.right
  data.eyeRightUpper = right.upper
  data.eyeRightLower = right.lower
  data.eyeRightCountour = right.upper.slice(10, 90).concat(right.lower.slice(10, 90).reverse())
  data.eyeLeftUpper = left.upper
  data.eyeLeftLower = left.lower
  data.eyeLeftCountour = left.upper.slice(10, 90).concat(left.lower.slice(10, 90).reverse())
  data.distanceBetweenEyes = randomFromInterval(data.faceWidth / 4.5, data.faceWidth / 4)
  data.eyeHeightOffset = randomFromInterval(data.faceHeight / 8, data.faceHeight / 6)
  data.leftEyeOffsetX = randomFromInterval(-data.faceWidth / 20, data.faceWidth / 10)
  data.leftEyeOffsetY = randomFromInterval(-data.faceHeight / 50, data.faceHeight / 50)
  data.rightEyeOffsetX = randomFromInterval(-data.faceWidth / 20, data.faceWidth / 10)
  data.rightEyeOffsetY = randomFromInterval(-data.faceHeight / 50, data.faceHeight / 50)
  data.leftEyeCenter = left.center[0]
  data.rightEyeCenter = right.center[0]
  data.leftPupilShiftX = randomFromInterval(-data.faceWidth / 20, data.faceWidth / 20)

  // now we generate the pupil shifts
  // we first pick a point from the upper eye lid
  let leftInd0 = Math.floor(randomFromInterval(10, left.upper.length - 10))
  let rightInd0 = Math.floor(randomFromInterval(10, right.upper.length - 10))
  let leftInd1 = Math.floor(randomFromInterval(10, left.upper.length - 10))
  let rightInd1 = Math.floor(randomFromInterval(10, right.upper.length - 10))
  let leftLerp = randomFromInterval(0.2, 0.8)
  let rightLerp = randomFromInterval(0.2, 0.8)

  data.leftPupilShiftY = left.upper[leftInd0][1] * leftLerp + left.lower[leftInd1][1] * (1 - leftLerp)
  data.rightPupilShiftY = right.upper[rightInd0][1] * rightLerp + right.lower[rightInd1][1] * (1 - rightLerp)
  data.leftPupilShiftX = left.upper[leftInd0][0] * leftLerp + left.lower[leftInd1][0] * (1 - leftLerp)
  data.rightPupilShiftX = right.upper[rightInd0][0] * rightLerp + right.lower[rightInd1][0] * (1 - rightLerp)

  var numHairLines = []
  var numHairMethods = 4
  for (var i = 0; i < numHairMethods; i++) {
    numHairLines.push(Math.floor(randomFromInterval(0, 50)))
  }
  data.hairs = []
  if (Math.random() > 0.3) {
    data.hairs = generateHairLines0(data.computedFacePoints, numHairLines[0] * 1 + 10)
  }
  if (Math.random() > 0.3) {
    data.hairs = data.hairs.concat(generateHairLines1(data.computedFacePoints, numHairLines[1] / 1.5 + 10))
  }
  if (Math.random() > 0.5) {
    data.hairs = data.hairs.concat(generateHairLines2(data.computedFacePoints, numHairLines[2] * 3 + 10))
  }
  if (Math.random() > 0.5) {
    data.hairs = data.hairs.concat(generateHairLines3(data.computedFacePoints, numHairLines[3] * 3 + 10))
  }
  data.rightNoseCenterX = randomFromInterval(data.faceWidth / 18, data.faceWidth / 12)
  data.rightNoseCenterY = randomFromInterval(0, data.faceHeight / 5)
  data.leftNoseCenterX = randomFromInterval(-data.faceWidth / 18, -data.faceWidth / 12)
  data.leftNoseCenterY = data.rightNoseCenterY + randomFromInterval(-data.faceHeight / 30, data.faceHeight / 20)
  if (Math.random() > 0.1) {
    // use natural hair color
    data.hairColor = data.hairColors[Math.floor(Math.random() * 10)]
  } else {
    data.hairColor = 'url(#rainbowGradient)'
    data.dyeColorOffset = randomFromInterval(0, 100) + '%'
  }

  var choice = Math.floor(Math.random() * 3)
  if (choice == 0) {
    data.mouthPoints = generateMouthShape0(data.computedFacePoints, data.faceHeight, data.faceWidth)
  } else if (choice == 1) {
    data.mouthPoints = generateMouthShape1(data.computedFacePoints, data.faceHeight, data.faceWidth)
  } else {
    data.mouthPoints = generateMouthShape2(data.computedFacePoints, data.faceHeight, data.faceWidth)
  }

  const svgTemplate = `
    <svg viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg" width="500" height="500" id="face-svg">
      <defs>
        <clipPath id="leftEyeClipPath">
          <polyline points="${data.eyeLeftUpper.concat(data.eyeLeftLower.reverse()).join(' ')}" />
        </clipPath>
        <clipPath id="rightEyeClipPath">
          <polyline points="${data.eyeRightUpper.concat(data.eyeRightLower.reverse()).join(' ')}" />
        </clipPath>
        <filter id="fuzzy">
          <feTurbulence id="turbulence" baseFrequency="0.05" numOctaves="3" type="turbulence" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" />
        </filter>
        <linearGradient id="rainbowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color: ${data.hairColors[Math.floor(Math.random() * data.hairColors.length)]};  stop-opacity: 1" />
          <stop offset="${data.dyeColorOffset}" style="stop-color: ${data.hairColors[Math.floor(Math.random() * data.hairColors.length)]};  stop-opacity: 1" />
          <stop offset="100%" style="stop-color: ${data.hairColors[Math.floor(Math.random() * data.hairColors.length)]};  stop-opacity: 1" />
        </linearGradient>
      </defs>
      <rect x="-100" y="-100" width="100%" height="100%" fill="${data.backgroundColors[Math.floor(Math.random() * data.backgroundColors.length)]}" />
      <polyline id="faceContour" points="${data.computedFacePoints.join(' ')}" fill="#ffc9a9" stroke="black" stroke-width="${3.0 / data.faceScale}" stroke-linejoin="round" filter="url(#fuzzy)" />
      <g transform="translate(${data.center[0] + data.distanceBetweenEyes + data.rightEyeOffsetX} ${-(-data.center[1] + data.eyeHeightOffset + data.rightEyeOffsetY)})">
        <polyline id="rightCountour" points="${data.eyeRightUpper.concat(data.eyeRightLower.reverse()).join(' ')}" fill="white" stroke="white" stroke-width="${0.0 / data.faceScale}" stroke-linejoin="round" filter="url(#fuzzy)" />
      </g>
      <g transform="translate(${-(data.center[0] + data.distanceBetweenEyes + data.leftEyeOffsetX)} ${-(-data.center[1] + data.eyeHeightOffset + data.leftEyeOffsetY)})">
        <polyline id="leftCountour" points="${data.eyeLeftUpper.concat(data.eyeLeftLower.reverse()).join(' ')}" fill="white" stroke="white" stroke-width="${0.0 / data.faceScale}" stroke-linejoin="round" filter="url(#fuzzy)" />
      </g>
      <g transform="translate(${data.center[0] + data.distanceBetweenEyes + data.rightEyeOffsetX} ${-(-data.center[1] + data.eyeHeightOffset + data.rightEyeOffsetY)})">
        <polyline id="rightUpper" points="${data.eyeRightUpper.join(' ')}" fill="none" stroke="black" stroke-width="${(data.haventSleptForDays ? 5.0 : 3.0) / data.faceScale}" stroke-linejoin="round" stroke-linecap="round" filter="url(#fuzzy)" />
        <polyline id="rightLower" points="${data.eyeRightLower.join(' ')}" fill="none" stroke="black" stroke-width="${(data.haventSleptForDays ? 5.0 : 3.0) / data.faceScale}" stroke-linejoin="round" stroke-linecap="round" filter="url(#fuzzy)" />
        ${Array.from(
          { length: 10 },
          (_, i) => `
          <circle r="${Math.random() * 2 + 3.0}" cx="${data.rightPupilShiftX + Math.random() * 5 - 2.5}" cy="${data.rightPupilShiftY + Math.random() * 5 - 2.5}" stroke="black" fill="none" stroke-width="${1.0 + Math.random() * 0.5}" filter="url(#fuzzy)" clip-path="url(#rightEyeClipPath)" />
        `
        ).join('')}
      </g>
      <g transform="translate(${-(data.center[0] + data.distanceBetweenEyes + data.leftEyeOffsetX)} ${-(-data.center[1] + data.eyeHeightOffset + data.leftEyeOffsetY)})">
        <polyline id="leftUpper" points="${data.eyeLeftUpper.join(' ')}" fill="none" stroke="black" stroke-width="${(data.haventSleptForDays ? 5.0 : 3.0) / data.faceScale}" stroke-linejoin="round" filter="url(#fuzzy)" />
        <polyline id="leftLower" points="${data.eyeLeftLower.join(' ')}" fill="none" stroke="black" stroke-width="${(data.haventSleptForDays ? 5.0 : 3.0) / data.faceScale}" stroke-linejoin="round" filter="url(#fuzzy)" />
        ${Array.from(
          { length: 10 },
          (_, i) => `
          <circle r="${Math.random() * 2 + 3.0}" cx="${data.leftPupilShiftX + Math.random() * 5 - 2.5}" cy="${data.leftPupilShiftY + Math.random() * 5 - 2.5}" stroke="black" fill="none" stroke-width="${1.0 + Math.random() * 0.5}" filter="url(#fuzzy)" clip-path="url(#leftEyeClipPath)" />
        `
        ).join('')}
      </g>
      <g id="hairs">
        ${data.hairs
          .map(
            (hair, index) => `
          <polyline points="${hair.join(' ')}" fill="none" stroke="${data.hairColor}" stroke-width="${0.5 + Math.random() * 2.5}" stroke-linejoin="round" filter="url(#fuzzy)" />
        `
          )
          .join('')}
      </g>
      ${
        Math.random() > 0.5
          ? `
        <g id="pointNose">
          <g id="rightNose">
            ${Array.from(
              { length: 10 },
              (_, i) => `
              <circle r="${Math.random() * 2 + 1.0}" cx="${data.rightNoseCenterX + Math.random() * 4 - 2}" cy="${data.rightNoseCenterY + Math.random() * 4 - 2}" stroke="black" fill="none" stroke-width="${1.0 + Math.random() * 0.5}" filter="url(#fuzzy)" />
            `
            ).join('')}
          </g>
          <g id="leftNose">
            ${Array.from(
              { length: 10 },
              (_, i) => `
              <circle r="${Math.random() * 2 + 1.0}" cx="${data.leftNoseCenterX + Math.random() * 4 - 2}" cy="${data.leftNoseCenterY + Math.random() * 4 - 2}" stroke="black" fill="none" stroke-width="${1.0 + Math.random() * 0.5}" filter="url(#fuzzy)" />
            `
            ).join('')}
          </g>
        </g>
      `
          : `
        <g id="lineNose">
          <path d="M ${data.leftNoseCenterX} ${data.leftNoseCenterY}, Q${data.rightNoseCenterX} ${data.rightNoseCenterY * 1.5},${(data.leftNoseCenterX + data.rightNoseCenterX) / 2} ${-data.eyeHeightOffset * 0.2}" fill="none" stroke="black" stroke-width="${2.5 + Math.random() * 1.0}" stroke-linejoin="round" filter="url(#fuzzy)"></path>
        </g>
      `
      }
      <g id="mouth">
        <polyline points="${data.mouthPoints.join(' ')}" fill="rgb(215,127,140)" stroke="black" stroke-width="${2.7 + Math.random() * 0.5}" stroke-linejoin="round" filter="url(#fuzzy)" />
      </g>
    </svg>
  `

  return createElement(svgTemplate)
}

export default function generateUglyAvatar() {
  const svgElement = createAvatarSvg()
  const serializer = new XMLSerializer()
  const svgString = serializer.serializeToString(svgElement)
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' })
  return svgBlob
}
