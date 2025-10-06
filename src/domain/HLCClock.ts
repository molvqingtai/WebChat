import { Remesh } from 'remesh'
import { createHLC, sendEvent as hlcSendEvent, receiveEvent as hlcReceiveEvent, type HLC } from '@/utils'

/**
 * HLCClock Domain
 *
 * Manages the local Hybrid Logical Clock state for the application.
 * This clock is used to:
 * - Generate timestamps for outgoing messages
 * - Update local time based on received messages
 * - Ensure causal ordering across distributed peers
 */
const HLCClockDomain = Remesh.domain({
  name: 'HLCClockDomain',
  impl: (domain) => {
    /**
     * Current HLC state
     */
    const HLCState = domain.state<HLC>({
      name: 'HLCClock.HLCState',
      default: createHLC()
    })

    /**
     * Query current HLC
     */
    const CurrentHLCQuery = domain.query({
      name: 'HLCClock.CurrentHLCQuery',
      impl: ({ get }) => {
        return get(HLCState())
      }
    })

    /**
     * Generate new HLC for sending a message
     * This updates the local clock and returns the new value
     */
    const SendEventCommand = domain.command({
      name: 'HLCClock.SendEventCommand',
      impl: ({ get }) => {
        const currentHLC = get(HLCState())
        const newHLC = hlcSendEvent(currentHLC)
        return [HLCState().new(newHLC), SendEventEvent(newHLC)]
      }
    })

    /**
     * Update local HLC based on received message
     * Takes the remote HLC and merges it with local clock
     */
    const ReceiveEventCommand = domain.command({
      name: 'HLCClock.ReceiveEventCommand',
      impl: ({ get }, remoteHLC: HLC) => {
        const currentHLC = get(HLCState())
        const newHLC = hlcReceiveEvent(currentHLC, remoteHLC)
        return [HLCState().new(newHLC), ReceiveEventEvent(newHLC)]
      }
    })

    /**
     * Reset HLC to initial state
     */
    const ResetCommand = domain.command({
      name: 'HLCClock.ResetCommand',
      impl: () => {
        const initialHLC = createHLC()
        return [HLCState().new(initialHLC), ResetEvent()]
      }
    })

    /**
     * Event emitted when HLC is updated by send
     */
    const SendEventEvent = domain.event<HLC>({
      name: 'HLCClock.SendEventEvent'
    })

    /**
     * Event emitted when HLC is updated by receive
     */
    const ReceiveEventEvent = domain.event<HLC>({
      name: 'HLCClock.ReceiveEventEvent'
    })

    /**
     * Event emitted when HLC is reset
     */
    const ResetEvent = domain.event({
      name: 'HLCClock.ResetEvent'
    })

    return {
      query: {
        CurrentHLCQuery
      },
      command: {
        SendEventCommand,
        ReceiveEventCommand,
        ResetCommand
      },
      event: {
        SendEventEvent,
        ReceiveEventEvent,
        ResetEvent
      }
    }
  }
})

export default HLCClockDomain
