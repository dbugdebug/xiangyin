# 面对React Vite的supabase环境文档

1. 环境配置
```
npm install @supabase/supabase-js
```

2. 添加文件
Add env variables, create a Supabase client, and use it in your app to query data.
Code:
File: .env
```bash
VITE_SUPABASE_URL=https://bkalpzlqwektfpxczhon.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Dd2CsCDtzPhNWOOkDcf6qA_eBFIM_uX
```

File: utils/supabase.ts
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
```

File: App.tsx
```typescript
import { useState, useEffect } from 'react'
import { supabase } from './utils/supabase'

export default function App() {
  const [todos, setTodos] = useState([])

  useEffect(() => {
    async function getTodos() {
      const { data: todos } = await supabase.from('todos').select()

      if (todos) {
        setTodos(todos)
      }
    }

    getTodos()
  }, [])

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  )
}
```

3.  Agent Skills (optional)
Agent Skills give AI coding tools ready-made instructions, scripts, and resources for working with Supabase more accurately and efficiently.
Code:
```
npx skills add supabase/agent-skills
```

