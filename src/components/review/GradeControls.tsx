import { Button } from '../common/Button';

export function GradeControls({ onGrade }: { onGrade: (quality: number) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Button onClick={() => onGrade(1)}>Again</Button>
      <Button onClick={() => onGrade(3)}>Hard</Button>
      <Button onClick={() => onGrade(5)}>Easy</Button>
    </div>
  );
}
