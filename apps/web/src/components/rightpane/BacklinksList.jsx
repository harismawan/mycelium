import React from 'react';
import styled from 'styled-components';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../../api/client.js';
import { PaneSection, SectionTitle, MutedText, StyledLink } from '../../styles/shared.js';

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
`;

const LinkItem = styled.li`
  margin-bottom: 2px;
`;

/**
 * Query key factory for backlinks.
 * @param {string} slug
 * @returns {string[]}
 */
const backlinkKeys = (slug) => ['backlinks', slug];

/**
 * Fetch and display backlinks for a note as clickable navigation items.
 *
 * @param {{ slug: string | undefined }} props
 * @returns {React.JSX.Element}
 */
export default function BacklinksList({ slug }) {
  const { data, isLoading } = useQuery({
    queryKey: backlinkKeys(slug ?? ''),
    queryFn: () => apiGet(`/notes/${slug}/backlinks`),
    enabled: !!slug,
  });

  const backlinks = data?.backlinks ?? [];

  return (
    <PaneSection>
      <SectionTitle>Belongs to</SectionTitle>
      {isLoading && <MutedText>Loading…</MutedText>}
      {!isLoading && backlinks.length === 0 && (
        <MutedText>No backlinks</MutedText>
      )}
      {backlinks.length > 0 && (
        <List>
          {backlinks.map((/** @type {{ slug: string, title: string, id: string }} */ bl) => (
            <LinkItem key={bl.id ?? bl.slug}>
              <StyledLink to={`/notes/${bl.slug}`}>{bl.title}</StyledLink>
            </LinkItem>
          ))}
        </List>
      )}
    </PaneSection>
  );
}
