import * as v from 'valibot'
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
import UserInfoDomain, { type UserInfo } from '@/domain/UserInfo'
import { checkSystemDarkMode, compressImage } from '@/utils'
import { RadioGroup, RadioGroupItem } from '@/components/ui/RadioGroup'
import { Label } from '@/components/ui/Label'
import { RefreshCcwIcon } from 'lucide-react'
import generateUglyAvatar from '@/lib/uglyAvatar'

// In chrome storage.sync, each key-value pair supports a maximum storage of 8kb
// Image is encoded as base64, and the size is increased by about 33%.
const COMPRESS_SIZE = 8 * 1024 * (1 - 0.33)

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
    v.maxBytes(8 * 1024, 'Your avatar cannot exceed 8kb.')
  ),
  themeMode: v.pipe(
    v.string(),
    v.union([v.literal('system'), v.literal('light'), v.literal('dark')], 'Please select extension theme mode.')
  )
})

const ProfileForm = () => {
  const send = useRemeshSend()
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

  const handleRandomAvatar = async () => {
    const svgBlob = generateUglyAvatar()

    // compressImage can't directly compress svg, need to convert to jpeg first
    const jpegBlob = await new Promise<Blob>((resolve, reject) => {
      const image = new Image()
      image.onload = async () => {
        const canvas = new OffscreenCanvas(image.width, image.height)
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(image, 0, 0)
        const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
        resolve(blob)
      }
      image.onerror = () => reject(new Error('Failed to load SVG'))
      image.src = URL.createObjectURL(svgBlob)
    })
    const miniAvatarBlob = await compressImage(jpegBlob, COMPRESS_SIZE)
    const miniAvatarBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('Failed to convert Blob to Base64'))
      reader.readAsDataURL(miniAvatarBlob)
    })
    console.log('kb', miniAvatarBase64.length / 1024)

    form.setValue('avatar', miniAvatarBase64)
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
                <div className="grid justify-items-center gap-y-2">
                  <AvatarSelect
                    compressSize={COMPRESS_SIZE}
                    onError={handleError}
                    onWarning={handleWarning}
                    className="shadow-lg"
                    {...field}
                  ></AvatarSelect>
                  <Button
                    type="button"
                    size="xs"
                    className="mx-auto flex items-center gap-x-2"
                    onClick={handleRandomAvatar}
                  >
                    <RefreshCcwIcon size={14} />
                    Random Avatar
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
