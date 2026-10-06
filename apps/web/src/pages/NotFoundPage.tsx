import { Link } from 'react-router';
import { PageHeader } from '../components/PageHeader';

/** 403/404 とも同じ文言（存在を漏らさない） */
export function NotFoundPage() {
  return (
    <div className="container">
      <PageHeader title="見つからないか権限がありません" lead="URL が誤っているか、この内容を表示する権限がありません。担当弁護士に案件メンバーへの追加を依頼してください。" />
      <Link to="/create" className="btn btn-primary">
        作成画面へ戻る
      </Link>
    </div>
  );
}
