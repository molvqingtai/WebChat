import { object, string, type Output, minLength, maxLength, toTrimmed, boolean } from 'valibot'
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
    minLength(1, 'Please enter your username.'),
    maxLength(8, 'Your username must have 8 characters or more.')
  ]),
  avatar: string(),
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
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="relative w-96 space-y-8 p-10">
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <AvatarSelect
                  className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 shadow-lg"
                  {...field}
                ></AvatarSelect>
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
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange}></Switch>
              </FormControl>
              <FormDescription>This is your public display name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}

ProfileForm.displayName = 'ProfileForm'

export default ProfileForm
