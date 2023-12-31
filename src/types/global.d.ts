export interface Message {
  id: string
  userId: string
  body: string
  username: string
  userAvatar: string
  date: number
  linkUsers: string[]
  likeChecked: boolean
  hateChecked: boolean
  likeCount: number
  hateUsers: string[]
  hateCount: number
}
