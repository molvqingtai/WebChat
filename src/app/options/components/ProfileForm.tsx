import { object, string, type Output, minBytes, maxBytes, toTrimmed, boolean, notLength } from 'valibot'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'

import AvatarSelect from './AvatarSelect'
import { Button } from '@/components/ui/Button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/Form'
import { Input } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'

const formSchema = object({
  username: string([
    toTrimmed(),
    minBytes(1, 'Please enter your username.'),
    maxBytes(20, 'Your username cannot exceed 20 bytes.')
  ]),
  avatar: string([notLength(0, 'Please select your avatar.')]),
  darkMode: boolean()
})

const ProfileForm = () => {
  const form = useForm({
    resolver: valibotResolver(formSchema),
    defaultValues: {
      username: '',
      avatar: '',
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches
    }
  })

  const handleSubmit = (data: Output<typeof formSchema>) => {
    console.log(data)
    console.log(data.avatar.length * 0.001)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="off" className="relative w-96 space-y-8 p-10">
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem className="absolute left-1/2 top-0 grid -translate-x-1/2 -translate-y-1/2 justify-items-center pb-8">
              <FormControl>
                <AvatarSelect className="shadow-lg" {...field}></AvatarSelect>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="username"
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
