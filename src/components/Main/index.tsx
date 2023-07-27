import { type FC } from 'react'
import Message from './Message'

const Main: FC = () => {
  const messages = [
    {
      id: '1',
      body: 'Who are you?',
      username: 'molvqingtai',
      avatar: 'https://github.com/shadcn.png',
      date: Date.now(),
      likeChecked: false,
      hateChecked: false,
      likeCount: 0,
      hateCount: 0
    },
    {
      id: '2',
      body: `I'm Chinese`,
      username: 'Love XJP',
      avatar: 'https://github.com/shadcn.png',
      date: Date.now(),
      likeChecked: false,
      hateChecked: false,
      likeCount: 0,
      hateCount: 0
    },
    {
      id: '1',
      body: 'Do you like XJP?',
      username: 'molvqingtai',
      avatar: 'https://github.com/shadcn.png',
      date: Date.now(),
      likeChecked: false,
      hateChecked: false,
      likeCount: 98,
      hateCount: 2
    }
  ]
  return (
    <div className="flex flex-col gap-y-4 p-4">
      {messages.map((message) => (
        <Message key={message.id} data={message} />
      ))}
    </div>
  )
}

Main.displayName = 'Main'

export default Main
