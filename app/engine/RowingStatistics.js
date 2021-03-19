'use strict'
/*
  Open Rowing Monitor, https://github.com/laberning/openrowingmonitor

  This Module calculates the training specific metrics.
*/
import { EventEmitter } from 'events'
import { createMovingIntervalAverager } from './MovingIntervalAverager.js'
import { createWeightedAverager } from './WeightedAverager.js'

// The number of strokes that are considered when averaging the calculated metrics
// Higher values create more stable metrics but make them less responsive
const numOfDataPointsForAveraging = 3

function createRowingStatistics () {
  const emitter = new EventEmitter()
  const strokeAverager = createWeightedAverager(numOfDataPointsForAveraging)
  const powerAverager = createWeightedAverager(numOfDataPointsForAveraging)
  const speedAverager = createWeightedAverager(numOfDataPointsForAveraging)
  const powerRatioAverager = createWeightedAverager(numOfDataPointsForAveraging)
  const caloriesAveragerMinute = createMovingIntervalAverager(60)
  const caloriesAveragerHour = createMovingIntervalAverager(60 * 60)
  let trainingRunning = false
  let durationTimer
  let rowingPausedTimer
  let distanceTotal = 0.0
  let durationTotal = 0
  let strokesTotal = 0
  let caloriesTotal = 0.0
  let lastStrokeDuration = 0.0
  let lastStrokeState = 'RECOVERY'

  function handleStroke (stroke) {
    if (!trainingRunning) startTraining()

    // if we do not get a stroke for 6 seconds we treat this as a rowing pause
    if (rowingPausedTimer)clearInterval(rowingPausedTimer)
    rowingPausedTimer = setTimeout(() => pauseRowing(), 6000)

    // based on: http://eodg.atm.ox.ac.uk/user/dudhia/rowing/physics/ergometer.html#section11
    const calories = (4 * powerAverager.weightedAverage() + 350) * (stroke.duration) / 4200
    powerAverager.pushValue(stroke.power)
    speedAverager.pushValue(stroke.distance / stroke.duration)
    powerRatioAverager.pushValue(stroke.durationDrivePhase / stroke.duration)
    strokeAverager.pushValue(stroke.duration)
    caloriesAveragerMinute.pushValue(calories, stroke.duration)
    caloriesAveragerHour.pushValue(calories, stroke.duration)
    caloriesTotal += calories
    distanceTotal += stroke.distance
    strokesTotal++
    lastStrokeDuration = stroke.duration
    lastStrokeState = stroke.strokeState

    emitter.emit('strokeFinished', getMetrics())
  }

  // initiated by the rowing engine in case an impulse was not considered
  // because it was too large
  function handlePause (duration) {
    caloriesAveragerMinute.pushValue(0, duration)
    caloriesAveragerHour.pushValue(0, duration)
  }

  // initiated when the stroke state changes
  function handleStrokeStateChange (state) {
    // todo: wee need a better mechanism to communicate strokeState updates
    // this is an initial hacky attempt to see if we can use it for the C2-pm5 protocol
    lastStrokeState = state.strokeState
    // emitter.emit('strokeFinished', getMetrics())
  }

  function getMetrics () {
    const splitTime = speedAverager.weightedAverage() !== 0 ? (500.0 / speedAverager.weightedAverage()) : 0
    return {
      durationTotal,
      durationTotalFormatted: secondsToTimeString(durationTotal),
      strokesTotal,
      distanceTotal: Math.round(distanceTotal), // meters
      caloriesTotal: Math.round(caloriesTotal), // kcal
      caloriesPerMinute: Math.round(caloriesAveragerMinute.average()),
      caloriesPerHour: Math.round(caloriesAveragerHour.average()),
      strokeTime: lastStrokeDuration.toFixed(2), // seconds
      power: Math.round(powerAverager.weightedAverage()), // watts
      split: splitTime, // seconds/500m
      splitFormatted: secondsToTimeString(splitTime),
      powerRatio: powerRatioAverager.weightedAverage().toFixed(2),
      strokesPerMinute: strokeAverager.weightedAverage() !== 0 ? (60.0 / strokeAverager.weightedAverage()).toFixed(1) : 0,
      speed: (speedAverager.weightedAverage() * 3.6).toFixed(2), // km/h
      strokeState: lastStrokeState
    }
  }

  function startTraining () {
    trainingRunning = true
    startDurationTimer()
  }

  function stopTraining () {
    trainingRunning = false
    stopDurationTimer()
    if (rowingPausedTimer)clearInterval(rowingPausedTimer)
  }

  function resetTraining () {
    stopTraining()
    distanceTotal = 0.0
    strokesTotal = 0
    caloriesTotal = 0.0
    durationTotal = 0
    caloriesAveragerMinute.reset()
    caloriesAveragerHour.reset()
    strokeAverager.reset()
    powerAverager.reset()
    speedAverager.reset()
    powerRatioAverager.reset()
  }

  // clear the displayed metrics in case the user pauses rowing
  function pauseRowing () {
    emitter.emit('rowingPaused', {
      durationTotal,
      durationTotalFormatted: secondsToTimeString(durationTotal),
      strokesTotal: strokesTotal,
      distanceTotal: Math.round(distanceTotal),
      caloriesTotal: Math.round(caloriesTotal)
    })
  }

  function startDurationTimer () {
    durationTimer = setInterval(() => {
      durationTotal++
      emitter.emit('durationUpdate', {
        durationTotal,
        durationTotalFormatted: secondsToTimeString(durationTotal)
      })
    }, 1000)
  }

  function stopDurationTimer () {
    clearInterval(durationTimer)
    durationTimer = undefined
  }

  // converts a timeStamp in seconds to a human readable hh:mm:ss format
  function secondsToTimeString (secondsTimeStamp) {
    const hours = Math.floor(secondsTimeStamp / 60 / 60)
    const minutes = Math.floor(secondsTimeStamp / 60) - (hours * 60)
    const seconds = Math.floor(secondsTimeStamp % 60)
    let timeString = hours > 0 ? ` ${hours.toString().padStart(2, '0')}:` : ''
    timeString += `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    return timeString
  }

  return Object.assign(emitter, {
    handleStroke,
    handlePause,
    handleStrokeStateChange,
    reset: resetTraining
  })
}

export { createRowingStatistics }
