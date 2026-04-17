import { faceImageStyle, type PhotoFocus } from '../../lib/face-focus';

export function FacePhoto({
  src,
  alt,
  containerClassName,
  imageClassName = 'h-full w-full object-cover',
  focus,
}: {
  src: string;
  alt: string;
  containerClassName: string;
  imageClassName?: string;
  focus?: PhotoFocus;
}) {
  return (
    <div className={`overflow-hidden ${containerClassName}`}>
      <img
        src={src}
        alt={alt}
        className={imageClassName}
        style={faceImageStyle(focus)}
      />
    </div>
  );
}
