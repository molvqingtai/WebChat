import hash from 'hash-it'
import { useMemo } from 'react'

const useDataId = (data: any) => useMemo(() => hash(data), [data])

export default useDataId
