import { useState } from 'react';
import type { Task } from '../lib/workTypes';
export function TaskEditor({
  task,
  goals,
  onSave,
}: {
  task: Task;
  goals: string[];
  onSave: (value: unknown) => Promise<void>;
}) {
  const [fields, setFields] = useState({
    title: task.title,
    notes: task.notes,
    owner: task.owner,
    waitingOn: task.waitingOn || '',
    goal: task.goal,
    dueDate: task.dueDate,
  });
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof fields, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  return (
    <form
      className="task-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await onSave({ taskId: task.id, revision: task.revision, ...fields });
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Title
        <input
          required
          maxLength={500}
          value={fields.title}
          onChange={(e) => update('title', e.target.value)}
        />
      </label>
      <label>
        Notes
        <textarea value={fields.notes} onChange={(e) => update('notes', e.target.value)} />
      </label>
      <label>
        Owner
        <input value={fields.owner} onChange={(e) => update('owner', e.target.value)} />
      </label>
      <label>
        Waiting on
        <input value={fields.waitingOn} onChange={(e) => update('waitingOn', e.target.value)} />
      </label>
      <label>
        Goal
        <select value={fields.goal} onChange={(e) => update('goal', e.target.value)}>
          <option value="">No goal</option>
          {[...new Set([...goals, ...(task.goal ? [task.goal] : [])])].map((goal) => (
            <option key={goal}>{goal}</option>
          ))}
        </select>
      </label>
      <label>
        Due date
        <input
          type="date"
          value={fields.dueDate}
          onChange={(e) => update('dueDate', e.target.value)}
        />
      </label>
      <button disabled={saving} className="primary" type="submit">
        Save task
      </button>
    </form>
  );
}
