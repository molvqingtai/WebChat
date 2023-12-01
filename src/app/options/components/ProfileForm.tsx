import { object, string, type Output, minBytes, maxBytes, toTrimmed, boolean, notLength } from 'valibot'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

import { toast } from 'sonner'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { nanoid } from 'nanoid'
import { useEffect } from 'react'
import AvatarSelect from './AvatarSelect'
import { Button } from '@/components/ui/Button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/Form'
import { Input } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import UserInfoDomain from '@/domain/UserInfo'

// In chrome storage.sync, each key-value pair supports a maximum storage of 8kb
// Image is encoded as base64, and the size is increased by about 33%.
const COMPRESS_SIZE = 8 * 1024 - 8 * 1024 * 0.33

const formSchema = object({
  id: string(),
  name: string([
    toTrimmed(),
    minBytes(1, 'Please enter your username.'),
    maxBytes(20, 'Your username cannot exceed 20 bytes.')
  ]),
  avatar: string([notLength(0, 'Please select your avatar.'), maxBytes(8 * 1024, 'Your avatar cannot exceed 8kb.')]),
  darkMode: boolean()
})

const ProfileForm = () => {
  const send = useRemeshSend()
  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())

  const form = useForm({
    resolver: valibotResolver(formSchema),
    defaultValues: userInfo ?? {
      id: nanoid(),
      name: '',
      avatar: '',
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches
    }
  })

  useEffect(() => {
    userInfo && form.reset(userInfo)
  }, [userInfo, form])

  const handleSubmit = (userInfo: Output<typeof formSchema>) => {
    send(userInfoDomain.command.SetUserInfoCommand(userInfo))
    toast.success('Saved successfully!')
  }

  const handleWarning = (error: Error) => {
    toast.warning(error.message)
  }

  const handleError = (error: Error) => {
    toast.error(error.message)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="off" className="relative w-96 space-y-8 p-10">
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem className="absolute left-1/2 top-0 grid -translate-x-1/2 -translate-y-1/2 justify-items-center">
              <FormControl>
                <AvatarSelect
                  compressSize={COMPRESS_SIZE}
                  onError={handleError}
                  onWarning={handleWarning}
                  className="shadow-lg"
                  {...field}
                ></AvatarSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="Please enter your username" {...field} />
              </FormControl>
              <FormDescription>This is your public display name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="darkMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>DarkMode</FormLabel>
              <div className="flex items-center gap-x-2">
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange}></Switch>
                </FormControl>
                <FormDescription>Enable dark mode</FormDescription>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <Button className="w-full" type="submit">
          Save
        </Button>
      </form>
    </Form>
  )
}

ProfileForm.displayName = 'ProfileForm'

export default ProfileForm
