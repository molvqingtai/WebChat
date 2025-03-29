import ProvideAdapter from '@/service/PeerRoom/adapter/ProvideAdapter'
import { provideChatRoom } from '@/service/PeerRoom/ChatRoom'
import { provideVirtualRoom } from '@/service/PeerRoom/VirtualRoom'

provideChatRoom(new ProvideAdapter())
provideVirtualRoom(new ProvideAdapter())
