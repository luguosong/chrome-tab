import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react'

/**
 * 编辑模式：右键切换。
 * 进入后导航/股票磁贴出现增删表单与删除标记，再次右键退出。
 * Changelog 是只读内容，不消费此状态。
 */
interface EditModeValue {
  editing: boolean
  toggle: () => void
}

const EditModeContext = createContext<EditModeValue>({
  editing: false,
  toggle: () => {},
})

export function EditModeProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false)
  return (
    <EditModeContext.Provider
      value={{ editing, toggle: () => setEditing((v) => !v) }}
    >
      {children}
    </EditModeContext.Provider>
  )
}

export function useEditMode() {
  return useContext(EditModeContext)
}
