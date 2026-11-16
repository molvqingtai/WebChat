import { DELIVERY_FAILURE_MESSAGE } from '@/constants/config'

/**
 * A frame that never left is kept in the input for the sender to retry, so a toast would only repeat
 * what the screen already shows. Everything else keeps its voice.
 */
export const shouldReportRoomError = (message: string) => message !== DELIVERY_FAILURE_MESSAGE
