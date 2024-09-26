import * as v from 'valibot'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { nanoid } from 'nanoid'
import { useEffect } from 'react'
import AvatarSelect from './AvatarSelect'
import { Button } from '@/components/ui/Button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/Form'
import { Input } from '@/components/ui/Input'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { checkSystemDarkMode, generateRandomAvatar } from '@/utils'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { RefreshCcwIcon } from 'lucide-react'
import { MAX_AVATAR_SIZE } from '@/constants/config'
import ToastDomain from '@/domain/Toast'
import BlurFade from '@/components/magicui/blur-fade'

const defaultUserInfo: UserInfo = {
  id: nanoid(),
  name: '',
  avatar: '',
  createTime: Date.now(),
  themeMode: checkSystemDarkMode() ? 'dark' : 'system'
}

const formSchema = v.object({
  id: v.string(),
  createTime: v.number(),
  // Pure numeric strings will be converted to number
  // Issues: https://github.com/unjs/unstorage/issues/277
  // name: v.string([
  //   // toTrimmed(),
  //   v.minBytes(1, 'Please enter your username.'),
  //   v.maxBytes(20, 'Your username cannot exceed 20 bytes.')
  // ]),
  name: v.pipe(
    v.string(),
    v.minBytes(1, 'Please enter your username.'),
    v.maxBytes(20, 'Your username cannot exceed 20 bytes.')
  ),
  avatar: v.pipe(
    v.string(),
    v.notLength(0, 'Please select your avatar.'),
    v.maxBytes(8 * 1024, `Your avatar cannot exceed 8kb.`)
  ),
  themeMode: v.pipe(
    v.string(),
    v.union([v.literal('system'), v.literal('light'), v.literal('dark')], 'Please select extension theme mode.')
  )
})

const ProfileForm = () => {
  const send = useRemeshSend()
  const toastDomain = useRemeshDomain(ToastDomain())

  const userInfoDomain = useRemeshDomain(UserInfoDomain())
  const userInfo = useRemeshQuery(userInfoDomain.query.UserInfoQuery())

  const form = useForm({
    resolver: valibotResolver(formSchema),
    defaultValues: userInfo ?? defaultUserInfo
  })

  // Update defaultValues
  useEffect(() => {
    userInfo && form.reset(userInfo)
  }, [userInfo, form])

  const handleSubmit = (userInfo: UserInfo) => {
    send(userInfoDomain.command.UpdateUserInfoCommand(userInfo))
    send(toastDomain.command.SuccessCommand('Saved successfully!'))
  }

  const handleWarning = (error: Error) => {
    send(toastDomain.command.WarningCommand(error.message))
  }

  const handleError = (error: Error) => {
    send(toastDomain.command.ErrorCommand(error.message))
  }

  const handleRefreshAvatar = async () => {
    const avatarBase64 = await generateRandomAvatar(MAX_AVATAR_SIZE)
    form.setValue('avatar', avatarBase64)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} autoComplete="off" className="relative w-96 space-y-8 p-10">
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem className="absolute inset-x-1 top-0 mx-auto grid w-fit -translate-y-1/2  justify-items-center">
              <FormControl>
                <BlurFade key={form.getValues().avatar} delay={0.1}>
                  <AvatarSelect
                    compressSize={MAX_AVATAR_SIZE}
                    onError={handleError}
                    onWarning={handleWarning}
                    className="shadow-lg"
                    {...field}
                  ></AvatarSelect>
                </BlurFade>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="button" size="xs" className="mx-auto flex items-center gap-x-2" onClick={handleRefreshAvatar}>
          <RefreshCcwIcon size={14} />
          Ugly Avatar
        </Button>
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
          name="themeMode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Theme Mode</FormLabel>
              <FormControl>
                <RadioGroup className="flex gap-x-4" onValueChange={field.onChange} value={field.value}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="system" id="r1" />
                    <Label htmlFor="r1">System</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="light" id="r2" />
                    <Label htmlFor="r2">Light</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dark" id="r3" />
                    <Label htmlFor="r3">Dark</Label>
                  </div>
                </RadioGroup>
              </FormControl>
              <FormDescription>
                The theme mode of the extension. If you choose the system, will follow the system theme.
              </FormDescription>
              <FormMessage />
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
