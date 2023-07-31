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
      id: '3',
      body: 'Do you like XJP?',
      username: 'molvqingtai',
      avatar: 'https://github.com/shadcn.png',
      date: Date.now(),
      likeChecked: false,
      hateChecked: true,
      likeCount: 9999,
      hateCount: 2
    }
  ]
  return (
    <div className="grid content-start overflow-y-auto p-4">
      {messages.map((message) => (
        <Message key={message.id} data={message} />
      ))}
    </div>
  )
}

Main.displayName = 'Main'

export default Main
