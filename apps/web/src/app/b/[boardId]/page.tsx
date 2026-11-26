import { SingleBoardView } from "@/playground/SingleBoardView";

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  return <SingleBoardView boardId={boardId} />;
}
