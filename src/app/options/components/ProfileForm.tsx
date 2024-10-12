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
import { ToastImpl } from '@/domain/impls/Toast'
import BlurFade from '@/components/magicui/BlurFade'
import { Checkbox } from '@/components/ui/checkbox'
import Link from '@/components/Link'

const defaultUserInfo: UserInfo = {
  id: nanoid(),
  name: '',
  avatar: '',
  createTime: Date.now(),
  themeMode: checkSystemDarkMode() ? 'dark' : 'system',
  danmakuEnabled: true,
  notificationEnabled: false
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
  ),
  danmakuEnabled: v.boolean(),
  notificationEnabled: v.boolean()
})

const ProfileForm = () => {
  const send = useRemeshSend()
  const toast = ToastImpl.value

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
    toast.success('Saved successfully!')
  }

  const handleWarning = (error: Error) => {
    toast.warning(error.message)
  }

  const handleError = (error: Error) => {
    toast.error(error.message)
  }

  const handleRefreshAvatar = async () => {
    const avatarBase64 = await generateRandomAvatar(MAX_AVATAR_SIZE)
    form.setValue('avatar', avatarBase64)
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        autoComplete="off"
        className="relative w-[450px] space-y-8 p-14 pt-20"
      >
        <FormField
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <FormItem className="absolute inset-x-1 top-0 mx-auto grid w-fit -translate-y-1/3  justify-items-center">
              <FormControl>
                <div className="flex flex-col items-center gap-2">
                  <BlurFade key={form.getValues().avatar} duration={0.1}>
                    <AvatarSelect
                      compressSize={MAX_AVATAR_SIZE}
                      onError={handleError}
                      onWarning={handleWarning}
                      className="shadow-lg"
                      {...field}
                    ></AvatarSelect>
                  </BlurFade>
                  <Button
                    type="button"
                    size="xs"
                    className="mx-auto flex items-center gap-x-2"
                    onClick={handleRefreshAvatar}
                  >
                    <RefreshCcwIcon size={14} />
                    Ugly Avatar
                  </Button>
                </div>
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
          name="danmakuEnabled"
          render={({ field }) => (
            <FormItem>
              {/* <FormLabel>Username</FormLabel> */}
              <FormControl>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    defaultChecked={false}
                    id="enable-danmaku"
                    onCheckedChange={field.onChange}
                    checked={field.value}
                  />
                  <FormLabel className="cursor-pointer" htmlFor="enable-danmaku">
                    Enable Danmaku
                  </FormLabel>
                </div>
              </FormControl>
              <FormDescription>
                Enabling this option will display scrolling messages on the website.
                <Link className="ml-2 text-primary" href="https://en.wikipedia.org/wiki/Danmaku_subtitling">
                  Wikipedia
                </Link>
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notificationEnabled"
          render={({ field }) => (
            <FormItem>
              {/* <FormLabel>Username</FormLabel> */}
              <FormControl>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    defaultChecked={false}
                    id="notification-enabled"
                    onCheckedChange={field.onChange}
                    checked={field.value}
                  />
                  <FormLabel className="cursor-pointer" htmlFor="notification-enabled">
                    Enable Notification
                  </FormLabel>
                </div>
              </FormControl>
              <FormDescription>Enabling this option will display desktop notifications for messages.</FormDescription>
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
