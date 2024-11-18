import * as v from 'valibot'
import { useForm } from 'react-hook-form'
import { valibotResolver } from '@hookform/resolvers/valibot'
import { useRemeshDomain, useRemeshQuery, useRemeshSend } from 'remesh-react'
import { nanoid } from 'nanoid'
import { useEffect, type FC } from 'react'
import AvatarSelect from './AvatarSelect'
import { Button } from '@/components/ui/Button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/Form'
import { Input } from '@/components/ui/Input'
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { cn, generateRandomAvatar } from '@/utils'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { RefreshCcwIcon } from 'lucide-react'
import { MAX_AVATAR_SIZE } from '@/constants/config'
import { ToastImpl } from '@/domain/impls/Toast'
import BlurFade from '@/components/magicui/BlurFade'
import { Checkbox } from '@/components/ui/Checkbox'
import Link from '@/components/Link'

const defaultUserInfo: UserInfo = {
  id: nanoid(),
  name: '',
  avatar: '',
  createTime: Date.now(),
  themeMode: 'system',
  danmakuEnabled: true,
  notificationEnabled: true,
  notificationType: 'at'
}

const formSchema = v.object({
  id: v.string(),
  // Pure numeric strings will be converted to number
  // Issues: https://github.com/unjs/unstorage/issues/277
  createTime: v.number(),
  name: v.pipe(
    v.string(),
    v.trim(),
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
  notificationEnabled: v.boolean(),
  notificationType: v.pipe(v.string(), v.union([v.literal('all'), v.literal('at')], 'Please select notification type.'))
})
const ProfileForm: FC = () => {
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
            <FormItem className="absolute inset-x-1 top-0 mx-auto grid w-fit -translate-y-1/3 justify-items-center">
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
              <FormLabel className="font-semibold">Username</FormLabel>
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
              <FormControl>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    defaultChecked={false}
                    id="enable-danmaku"
                    onCheckedChange={field.onChange}
                    checked={field.value}
                  />
                  <FormLabel className="cursor-pointer font-semibold" htmlFor="enable-danmaku">
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
          name="notificationType"
          render={({ field }) => (
            <FormItem>
              <FormField
                control={form.control}
                name="notificationEnabled"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          defaultChecked={false}
                          id="enable-notification"
                          onCheckedChange={field.onChange}
                          checked={field.value}
                        />
                        <FormLabel className="cursor-pointer font-semibold" htmlFor="enable-notification">
                          Enable Notification
                        </FormLabel>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormControl className="pl-6">
                <RadioGroup
                  disabled={!form.getValues('notificationEnabled')}
                  className="flex gap-x-4"
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="all" id="all" />
                    <Label
                      className={cn(
                        'cursor-pointer',
                        !form.getValues('notificationEnabled') && 'cursor-not-allowed opacity-50'
                      )}
                      htmlFor="all"
                    >
                      All message
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="at" id="at" />
                    <Label
                      className={cn(
                        'cursor-pointer',
                        !form.getValues('notificationEnabled') && 'cursor-not-allowed opacity-50'
                      )}
                      htmlFor="at"
                    >
                      Only @self
                    </Label>
                  </div>
                </RadioGroup>
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
              <FormLabel className="font-semibold">Theme Mode</FormLabel>
              <FormControl>
                <RadioGroup className="flex gap-x-4" onValueChange={field.onChange} value={field.value}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="system" id="system" />
                    <Label className="cursor-pointer" htmlFor="system">
                      System
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="light" id="light" />
                    <Label className="cursor-pointer" htmlFor="light">
                      Light
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="dark" id="dark" />
                    <Label className="cursor-pointer" htmlFor="dark">
                      Dark
                    </Label>
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
