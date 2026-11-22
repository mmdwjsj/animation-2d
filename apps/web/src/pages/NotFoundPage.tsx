import { Link } from 'react-router-dom';
import Button from '../components/Button';

export default function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
      <p className="text-5xl font-light text-line">404</p>
      <h1 className="text-lg text-ink">页面不存在</h1>
      <p className="text-sm text-muted">请检查地址，或返回项目首页继续制作。</p>
      <Link to="/">
        <Button variant="primary">返回项目首页</Button>
      </Link>
    </div>
  );
}
